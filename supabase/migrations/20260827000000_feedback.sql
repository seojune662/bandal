-- Release 1 feedback inbox. Clients cannot touch the table directly; the
-- SECURITY DEFINER RPC is the sole ingestion path.

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('bug', 'friction', 'feature')),
  body        text not null check (char_length(body) between 1 and 4000),
  app_version text,
  os          text,
  palette     text,
  user_id     uuid null references auth.users(id)
);

create index feedback_created_at_idx
  on public.feedback (created_at desc);

create index feedback_user_created_at_idx
  on public.feedback (user_id, created_at desc)
  where user_id is not null;

comment on table public.feedback is
  'Release 1 product feedback. No client SELECT/UPDATE/DELETE or direct INSERT; submit_feedback() is the only write path.';

alter table public.feedback enable row level security;

-- Deliberately no policies. Even a submitter cannot read, edit or delete an
-- accepted row, and INSERT is available only through the definer RPC below.
revoke all on public.feedback from public, anon, authenticated;

create or replace function public.submit_feedback(
  p_kind text,
  p_body text,
  p_app_version text,
  p_os text,
  p_palette text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_global_count int;
begin
  -- IP identity is unavailable in this RPC. Serialize this small critical
  -- section and apply a gentle limit across anonymous + authenticated calls.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bandal.submit_feedback.global', 0)
  );

  select count(*)::int
    into v_global_count
    from public.feedback f
   where f.created_at > now() - interval '1 minute';

  if v_global_count >= 30 then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            detail = 'submit_feedback_global';
  end if;

  -- Existing rate_events/check_rate convention: authenticated identities get
  -- the tighter per-user limit. Anonymous callers have only the global limit.
  if v_uid is not null then
    perform public.check_rate('submit_feedback', 5, interval '1 hour');
  end if;

  insert into public.feedback (
    kind,
    body,
    app_version,
    os,
    palette,
    user_id
  ) values (
    p_kind,
    p_body,
    p_app_version,
    p_os,
    p_palette,
    v_uid
  );
end;
$$;

comment on function public.submit_feedback(text, text, text, text, text) is
  'Feedback intake. Limit: 30/min globally and, when signed in, 5/hour/user. Raises P0001 rate_limited.';

-- Supabase may grant default function privileges directly to client roles.
-- Revoke all first, then expose only this intentional public RPC.
revoke execute on function public.submit_feedback(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_feedback(text, text, text, text, text)
  to anon, authenticated;
