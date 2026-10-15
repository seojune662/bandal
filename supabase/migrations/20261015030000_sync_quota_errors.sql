-- Storage hides generic P0001 messages as HTTP 500. Permission errors preserve
-- this fixed, non-sensitive code so clients can explain a full allowance without
-- guessing from an unrelated server error. Accounting/locking are unchanged.
create or replace function public.bandal_sync_apply_usage(actor uuid,record_delta bigint,asset_delta bigint,unknown_delta bigint,require_write boolean)
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
    raise exception 'sync_storage_quota_exceeded' using errcode='42501';
  end if;
  update public.bandal_sync_usage set record_bytes=record_bytes+record_delta,
    asset_bytes=asset_bytes+asset_delta,unknown_assets=unknown_assets+unknown_delta where user_id=actor;
end $$;
revoke all on function public.bandal_sync_apply_usage(uuid,bigint,bigint,bigint,boolean) from public,anon,authenticated;
