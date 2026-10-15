-- The personal-sync schema was installed separately on 2026-10-13. This adds
-- paid cloud writes without changing local packs or access to already saved data.
begin;

do $$ begin
  if to_regprocedure('public.bandal_push(jsonb)') is null or
     to_regclass('public.bandal_records') is null then
    raise exception 'personal_sync_schema_required';
  end if;
end $$;

-- Backfill and trigger installation must see one consistent set of objects.
lock table public.bandal_records, storage.objects in share row exclusive mode;

create table public.bandal_sync_configuration (
  singleton boolean primary key default true check(singleton),
  enforce_paid_access boolean not null default false
);
insert into public.bandal_sync_configuration(singleton) values(true);
create table public.bandal_sync_beta_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check(length(reason) between 1 and 200),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.bandal_sync_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  record_bytes bigint not null default 0 check(record_bytes >= 0),
  asset_bytes bigint not null default 0 check(asset_bytes >= 0),
  unknown_assets bigint not null default 0 check(unknown_assets >= 0)
);
do $$ declare t text; begin
  foreach t in array array['configuration','beta_access','usage'] loop
    execute format('alter table public.bandal_sync_%I enable row level security',t);
    execute format('revoke all on public.bandal_sync_%I from public,anon,authenticated',t);
    execute format('grant all on public.bandal_sync_%I to service_role',t);
  end loop;
end $$;

-- Only Storage's backend-reported size is final. Its pre-upload permission
-- probe can have contentLength, but that request value is not a trusted size.
create function public.bandal_sync_asset_bytes(metadata_input jsonb) returns bigint
language sql immutable set search_path='' as $$
  select case when metadata_input->>'size' ~ '^[0-9]{1,18}$'
    then (metadata_input->>'size')::bigint else null end
$$;
create function public.bandal_sync_record_bytes(envelope_input jsonb) returns bigint
language sql immutable set search_path='' as $$
  select case when envelope_input->>'deleted'='true' then 0::bigint
    else octet_length(decode(envelope_input->>'payload','base64'))::bigint end
$$;

insert into public.bandal_sync_usage(user_id,record_bytes)
  select user_id,coalesce(sum(public.bandal_sync_record_bytes(envelope)),0)
    from public.bandal_records group by user_id;
insert into public.bandal_sync_usage(user_id,asset_bytes,unknown_assets)
  select split_part(name,'/',1)::uuid,
    coalesce(sum(public.bandal_sync_asset_bytes(metadata)),0),
    count(*) filter(where public.bandal_sync_asset_bytes(metadata) is null)
  from storage.objects where bucket_id='bandal-assets'
  group by split_part(name,'/',1)::uuid
  on conflict(user_id) do update set asset_bytes=excluded.asset_bytes,unknown_assets=excluded.unknown_assets;

create function public.bandal_sync_access_for(actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare enabled boolean; paid jsonb; source text := 'none'; allowed boolean := false; begin
  if actor is null then raise exception 'sync_authentication_required' using errcode='42501'; end if;
  select enforce_paid_access into strict enabled from public.bandal_sync_configuration where singleton;
  -- Sandbox purchases never enter this decision. Beta access is a separate,
  -- expiring operator grant, not a fabricated payment or subscription.
  paid := public.paddle_billing_status(actor,'live');
  if not enabled then source := 'rollout'; allowed := true;
  elsif coalesce((paid->>'active')::boolean,false) then source := 'subscription'; allowed := true;
  elsif exists(select 1 from public.bandal_sync_beta_access where user_id=actor and expires_at > now())
    then source := 'beta'; allowed := true;
  end if;
  return jsonb_build_object('writeAllowed',allowed,'accessSource',source,
    'enforcePaidAccess',enabled,'storageLimitBytes',case when allowed then 5368709120::bigint else 0 end,
    'paidThrough',paid->'paidThrough');
end $$;

create function public.bandal_sync_status_for(actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare usage public.bandal_sync_usage; begin
  if actor is null then raise exception 'sync_authentication_required' using errcode='42501'; end if;
  select * into usage from public.bandal_sync_usage where user_id=actor;
  return public.bandal_sync_access_for(actor) || jsonb_build_object(
    'storageUsedBytes',coalesce(usage.record_bytes,0)+coalesce(usage.asset_bytes,0),
    'recordBytes',coalesce(usage.record_bytes,0),'assetBytes',coalesce(usage.asset_bytes,0),
    'usageComplete',coalesce(usage.unknown_assets,0)=0);
end $$;

create function public.bandal_sync_status() returns jsonb
language sql stable security definer set search_path='' as $$
  select public.bandal_sync_status_for(auth.uid())
$$;

-- Every record/object change uses this same locked ledger. Recalculating a SUM
-- under the statement's old MVCC snapshot would allow concurrent over-allocation.
create function public.bandal_sync_apply_usage(actor uuid,record_delta bigint,asset_delta bigint,unknown_delta bigint,require_write boolean)
returns void language plpgsql security definer set search_path='' as $$
declare enabled boolean; before_usage public.bandal_sync_usage; next_total bigint; begin
  select enforce_paid_access into strict enabled from public.bandal_sync_configuration where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if enabled and require_write and not (public.bandal_sync_access_for(actor)->>'writeAllowed')::boolean then
    raise exception 'sync_subscription_required' using errcode='42501';
  end if;
  insert into public.bandal_sync_usage(user_id) values(actor) on conflict do nothing;
  select * into strict before_usage from public.bandal_sync_usage where user_id=actor for update;
  next_total := before_usage.record_bytes+before_usage.asset_bytes+record_delta+asset_delta;
  if enabled and record_delta+asset_delta > 0 and next_total > 5368709120::bigint then
    raise exception 'sync_storage_quota_exceeded' using errcode='P0001';
  end if;
  update public.bandal_sync_usage set record_bytes=record_bytes+record_delta,
    asset_bytes=asset_bytes+asset_delta,unknown_assets=unknown_assets+unknown_delta where user_id=actor;
end $$;

create function public.bandal_sync_record_usage_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_bytes bigint := 0; new_bytes bigint := 0; actor uuid; begin
  if tg_op <> 'INSERT' then old_bytes := public.bandal_sync_record_bytes(old.envelope); actor := old.user_id; end if;
  if tg_op <> 'DELETE' then new_bytes := public.bandal_sync_record_bytes(new.envelope); actor := new.user_id; end if;
  if tg_op='UPDATE' and new.user_id <> old.user_id then raise exception 'sync_owner_immutable'; end if;
  -- A cascading account deletion may already have removed its usage row.
  if tg_op <> 'DELETE' or exists(select 1 from auth.users where id=actor) then
    perform public.bandal_sync_apply_usage(actor,new_bytes-old_bytes,0,0,tg_op <> 'DELETE');
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
-- AFTER avoids charging an INSERT ... ON CONFLICT twice (insert probe + update).
create trigger bandal_sync_record_usage after insert or update or delete on public.bandal_records
  for each row execute function public.bandal_sync_record_usage_trigger();

create function public.bandal_sync_storage_usage_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid; old_bytes bigint := 0; new_bytes bigint := 0; old_unknown bigint := 0; new_unknown bigint := 0; begin
  if tg_op='UPDATE' and (old.bucket_id='bandal-assets' or new.bucket_id='bandal-assets') and
     (old.name <> new.name or old.bucket_id <> new.bucket_id) then raise exception 'sync_asset_path_immutable'; end if;
  if tg_op <> 'INSERT' and old.bucket_id='bandal-assets' then
    actor := split_part(old.name,'/',1)::uuid;
    old_bytes := public.bandal_sync_asset_bytes(old.metadata);
    old_unknown := case when old_bytes is null then 1 else 0 end;
  end if;
  if tg_op <> 'DELETE' and new.bucket_id='bandal-assets' then
    if new.name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}$' then
      raise exception 'sync_asset_path_invalid';
    end if;
    actor := split_part(new.name,'/',1)::uuid;
    new_bytes := public.bandal_sync_asset_bytes(new.metadata);
    new_unknown := case when new_bytes is null then 1 else 0 end;
  end if;
  if actor is not null and (tg_op <> 'DELETE' or exists(select 1 from auth.users where id=actor)) then
    perform public.bandal_sync_apply_usage(actor,0,coalesce(new_bytes,0)-coalesce(old_bytes,0),new_unknown-old_unknown,tg_op <> 'DELETE');
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger bandal_sync_storage_usage after insert or update or delete on storage.objects
  for each row execute function public.bandal_sync_storage_usage_trigger();

-- Supabase's permission probes INSERT and then roll back before COMMIT. Final
-- writes must have the actual backend size, even if metadata arrived later in
-- the transaction. A deferred check permits probes but never an unknown-size
-- committed upload. The Storage API handles removal of failed upload bytes.
create function public.bandal_sync_storage_commit_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare actual_size bigint; final_exists boolean; begin
  if not (select enforce_paid_access from public.bandal_sync_configuration where singleton) then return null; end if;
  select public.bandal_sync_asset_bytes(metadata),true into actual_size,final_exists
    from storage.objects where id=new.id and bucket_id='bandal-assets';
  if coalesce(final_exists,false) and (actual_size is null or actual_size > 536870912) then
    raise exception 'sync_asset_size_unverified' using errcode='P0001';
  end if;
  return null;
end $$;
create constraint trigger bandal_sync_storage_commit after insert or update on storage.objects
  deferrable initially deferred for each row execute function public.bandal_sync_storage_commit_trigger();

create function public.bandal_sync_configuration_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.enforce_paid_access and not old.enforce_paid_access and
    exists(select 1 from public.bandal_sync_usage where unknown_assets <> 0) then
    raise exception 'sync_usage_reconciliation_required';
  end if;
  return new;
end $$;
create trigger bandal_sync_configuration_guard before update on public.bandal_sync_configuration
  for each row execute function public.bandal_sync_configuration_trigger();

-- Retain the tested revision/conflict/idempotence protocol behind a wrapper.
-- The original function is no longer callable by clients.
alter function public.bandal_push(jsonb) rename to bandal_push_unmetered;
revoke all on function public.bandal_push_unmetered(jsonb) from public,anon,authenticated;
create function public.bandal_push(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); enabled boolean; begin
  if actor is null then raise exception 'sync_authentication_required' using errcode='42501'; end if;
  select enforce_paid_access into strict enabled from public.bandal_sync_configuration where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if enabled then
    if not (public.bandal_sync_access_for(actor)->>'writeAllowed')::boolean then
      raise exception 'sync_subscription_required' using errcode='42501';
    end if;
  end if;
  return public.bandal_push_unmetered(p_operation);
end $$;

-- SELECT, download and pull stay owner-only and work after a subscription ends.
-- The insert policy also rejects unpaid upload probes before network transfer.
drop policy bandal_assets_create on storage.objects;
create policy bandal_assets_create on storage.objects for insert to authenticated with check (
  bucket_id='bandal-assets' and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{64}$')
  and (public.bandal_sync_status()->>'writeAllowed')::boolean
);

revoke all on function public.bandal_sync_asset_bytes(jsonb),public.bandal_sync_record_bytes(jsonb),
  public.bandal_sync_access_for(uuid),public.bandal_sync_apply_usage(uuid,bigint,bigint,bigint,boolean),
  public.bandal_sync_record_usage_trigger(),public.bandal_sync_storage_usage_trigger(),
  public.bandal_sync_storage_commit_trigger(),public.bandal_sync_configuration_trigger(),
  public.bandal_sync_status_for(uuid),public.bandal_sync_status(),public.bandal_push(jsonb) from public,anon,authenticated;
grant execute on function public.bandal_sync_status(),public.bandal_push(jsonb) to authenticated;
grant execute on function public.bandal_sync_access_for(uuid),public.bandal_sync_status_for(uuid),public.bandal_sync_status() to service_role;
commit;
