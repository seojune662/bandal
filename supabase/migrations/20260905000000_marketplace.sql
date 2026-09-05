-- Marketplace: clients read with RLS; validated artifacts enter via the server.
create table public.marketplace_publishers (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  user_id uuid not null unique references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);
create table public.marketplace_reviewers (
  user_id uuid primary key references auth.users(id)
);
create table public.marketplace_plugins (
  id text primary key check (length(id) <= 128),
  publisher_id text not null references public.marketplace_publishers(id),
  created_at timestamptz not null default now()
);
create table public.marketplace_releases (
  id uuid primary key default gen_random_uuid(),
  plugin_id text not null references public.marketplace_plugins(id),
  version text not null check (length(version) <= 100),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  artifact_path text not null unique,
  artifact_bytes integer not null check (artifact_bytes between 1 and 8388608),
  changelog text not null default '' check (length(changelog) <= 10000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  review_reason text not null default '',
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (plugin_id, version)
);
create index marketplace_release_status on public.marketplace_releases(status, created_at desc);
create table public.marketplace_audit (
  id bigint generated always as identity primary key,
  release_id uuid not null references public.marketplace_releases(id),
  actor uuid not null references auth.users(id),
  action text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table public.marketplace_reports (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.marketplace_releases(id),
  user_id uuid not null references auth.users(id),
  reason text not null check (length(reason) between 1 and 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(release_id, user_id)
);

create function public.marketplace_is_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.marketplace_reviewers where user_id = auth.uid())
$$;
revoke all on function public.marketplace_is_reviewer() from public;
grant execute on function public.marketplace_is_reviewer() to anon, authenticated;

alter table public.marketplace_publishers enable row level security;
alter table public.marketplace_reviewers enable row level security;
alter table public.marketplace_plugins enable row level security;
alter table public.marketplace_releases enable row level security;
alter table public.marketplace_audit enable row level security;
alter table public.marketplace_reports enable row level security;
revoke all on public.marketplace_publishers, public.marketplace_reviewers, public.marketplace_plugins,
  public.marketplace_releases, public.marketplace_audit, public.marketplace_reports from anon, authenticated;
grant select on public.marketplace_publishers, public.marketplace_plugins, public.marketplace_releases to anon, authenticated;
grant select on public.marketplace_reviewers, public.marketplace_audit, public.marketplace_reports to authenticated;
grant insert on public.marketplace_publishers, public.marketplace_reports to authenticated;
grant all on public.marketplace_publishers, public.marketplace_reviewers, public.marketplace_plugins,
  public.marketplace_releases, public.marketplace_audit, public.marketplace_reports to service_role;
grant usage, select on sequence public.marketplace_audit_id_seq to service_role;
create policy publisher_read on public.marketplace_publishers for select using (true);
create policy publisher_register on public.marketplace_publishers for insert to authenticated with check (
  user_id = auth.uid() and id not in ('bandal', 'official', 'admin', 'support')
);
create policy plugin_read on public.marketplace_plugins for select using (true);
create policy reviewer_self on public.marketplace_reviewers for select to authenticated using (user_id = auth.uid());
create policy release_read on public.marketplace_releases for select using (
  status = 'approved' or public.marketplace_is_reviewer() or exists (
    select 1 from public.marketplace_plugins p join public.marketplace_publishers u on u.id = p.publisher_id
    where p.id = plugin_id and u.user_id = auth.uid()
  )
);
create policy audit_read on public.marketplace_audit for select to authenticated using (public.marketplace_is_reviewer());
create policy report_read on public.marketplace_reports for select to authenticated using (user_id = auth.uid() or public.marketplace_is_reviewer());
create policy report_create on public.marketplace_reports for insert to authenticated with check (
  user_id = auth.uid() and resolved_at is null and exists (
    select 1 from public.marketplace_releases r where r.id = release_id and r.status = 'approved'
  )
);

-- The server validates the ZIP and computes all metadata before calling this.
create function public.marketplace_submit_release(
  actor uuid, manifest_input jsonb, hash_input text, path_input text,
  bytes_input integer, changelog_input text
) returns public.marketplace_releases
language plpgsql security definer set search_path = '' as $$
declare publisher text; plugin text := manifest_input->>'id'; release public.marketplace_releases;
begin
  select id into publisher from public.marketplace_publishers where user_id = actor;
  if publisher is null or plugin is null or left(plugin, length(publisher) + 1) <> publisher || '.' then
    raise exception 'publisher_namespace_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(publisher, 0));
  if (select count(*) from public.marketplace_releases r join public.marketplace_plugins p on p.id = r.plugin_id
      where p.publisher_id = publisher and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'submission_rate_limited';
  end if;
  insert into public.marketplace_plugins(id, publisher_id) values(plugin, publisher) on conflict do nothing;
  if not exists(select 1 from public.marketplace_plugins where id = plugin and publisher_id = publisher) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  insert into public.marketplace_releases(plugin_id, version, manifest, sha256, artifact_path, artifact_bytes, changelog)
    values(plugin, manifest_input->>'version', manifest_input, hash_input, path_input, bytes_input, changelog_input)
    returning * into release;
  insert into public.marketplace_audit(release_id, actor, action, reason) values(release.id, actor, 'submitted', '');
  return release;
end $$;
revoke all on function public.marketplace_submit_release(uuid,jsonb,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.marketplace_submit_release(uuid,jsonb,text,text,integer,text) to service_role;

create function public.marketplace_review_release(release_id_input uuid, decision text, reason_input text)
returns public.marketplace_releases language plpgsql security definer set search_path = '' as $$
declare release public.marketplace_releases;
begin
  if not public.marketplace_is_reviewer() then raise exception 'not_reviewer' using errcode = '42501'; end if;
  if decision not in ('approved', 'rejected', 'withdrawn') or length(trim(reason_input)) not between 1 and 2000 then
    raise exception 'invalid_review';
  end if;
  select * into strict release from public.marketplace_releases where id = release_id_input for update;
  if not ((release.status = 'pending' and decision in ('approved','rejected')) or
          (release.status = 'approved' and decision = 'withdrawn')) then raise exception 'invalid_transition'; end if;
  update public.marketplace_releases set status = decision, review_reason = reason_input,
    reviewed_by = auth.uid(), reviewed_at = now() where id = release.id returning * into release;
  insert into public.marketplace_audit(release_id, actor, action, reason) values(release.id, auth.uid(), decision, reason_input);
  return release;
end $$;
revoke all on function public.marketplace_review_release(uuid,text,text) from public;
grant execute on function public.marketplace_review_release(uuid,text,text) to authenticated;

create function public.marketplace_resolve_report(report_id_input uuid, reason_input text)
returns void language plpgsql security definer set search_path = '' as $$
declare report public.marketplace_reports;
begin
  if not public.marketplace_is_reviewer() then raise exception 'not_reviewer' using errcode = '42501'; end if;
  if length(trim(reason_input)) not between 1 and 2000 then raise exception 'invalid_reason'; end if;
  select * into strict report from public.marketplace_reports where id = report_id_input for update;
  if report.resolved_at is not null then raise exception 'already_resolved'; end if;
  update public.marketplace_reports set resolved_at = now() where id = report.id;
  insert into public.marketplace_audit(release_id, actor, action, reason)
    values(report.release_id, auth.uid(), 'report_resolved', report.id::text || ': ' || reason_input);
end $$;
revoke all on function public.marketplace_resolve_report(uuid,text) from public;
grant execute on function public.marketplace_resolve_report(uuid,text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace-artifacts', 'marketplace-artifacts', false, 8388608, array['application/zip'])
on conflict (id) do nothing;
-- Deliberately no client policies for artifact storage. The server checks
-- release visibility for every download; withdrawn URLs immediately stop.
