begin;
-- Apple identifiers remain reserved after account deletion. They must never be
-- adopted by another account during restore; retained rows contain no email/name.
create table public.apple_billing_accounts (
  app_account_token uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  purchase_pending_until timestamptz,
  created_at timestamptz not null default now()
);
create table public.apple_billing_subscriptions (
  environment text not null check(environment in ('production','sandbox')),
  original_transaction_id text not null,
  app_account_token uuid not null references public.apple_billing_accounts(app_account_token),
  product_id text not null,
  plan text not null check(plan in ('monthly','annual')),
  status integer not null check(status between 1 and 5),
  expires_at timestamptz not null,
  grace_expires_at timestamptz,
  auto_renew boolean not null,
  revoked_at timestamptz,
  signed_at timestamptz not null,
  primary key(environment,original_transaction_id)
);
create table public.apple_billing_transactions (
  environment text not null check(environment in ('production','sandbox')),
  transaction_id text not null,
  original_transaction_id text not null,
  app_account_token uuid not null references public.apple_billing_accounts(app_account_token),
  product_id text not null,
  purchased_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_type text,
  revocation_percentage integer check(revocation_percentage between 0 and 100000),
  signed_at timestamptz not null,
  primary key(environment,transaction_id)
);
create table public.apple_billing_events (
  environment text not null check(environment in ('production','sandbox')),
  event_id text not null,
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  primary key(environment,event_id)
);
do $$ declare t text; begin
  foreach t in array array['accounts','subscriptions','transactions','events'] loop
    execute format('alter table public.apple_billing_%I enable row level security',t);
    execute format('revoke all on public.apple_billing_%I from public,anon,authenticated',t);
    execute format('grant all on public.apple_billing_%I to service_role',t);
  end loop;
end $$;

create function public.bandal_subscription_status_for(actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare paddle jsonb; sources jsonb; active_count integer; valid_until timestamptz; begin
  if actor is null then raise exception 'sign_in_required' using errcode='42501'; end if;
  paddle := public.paddle_billing_status(actor,'live');
  with entries as (
    select jsonb_build_object('provider','paddle','environment','production','active',coalesce((paddle->>'active')::boolean,false),
      'plan',paddle->'plan','status',paddle->'status','validUntil',paddle->'paidThrough',
      'cancelAtPeriodEnd',coalesce((paddle->>'cancelAtPeriodEnd')::boolean,false),'canManage',coalesce((paddle->>'canManageBilling')::boolean,false)) as item
    where paddle->>'status' <> 'none' or coalesce((paddle->>'canManageBilling')::boolean,false)
    union all
    select jsonb_build_object('provider','apple','environment','production',
      'active',s.revoked_at is null and ((s.status=1 and s.expires_at>now()) or (s.status=4 and s.grace_expires_at>now())),
      'plan',s.plan,'status',case s.status when 1 then 'active' when 2 then 'expired' when 3 then 'billing_retry' when 4 then 'grace_period' else 'revoked' end,
      'validUntil',case when s.status=4 then s.grace_expires_at else s.expires_at end,
      'cancelAtPeriodEnd',not s.auto_renew,'canManage',true)
    from public.apple_billing_subscriptions s join public.apple_billing_accounts a using(app_account_token)
    where a.user_id=actor and s.environment='production'
  ) select coalesce(jsonb_agg(item),'[]'::jsonb),count(*) filter(where (item->>'active')::boolean),
    max((item->>'validUntil')::timestamptz) filter(where (item->>'active')::boolean)
    into sources,active_count,valid_until from entries;
  return jsonb_build_object('active',active_count>0,'sources',sources,'validUntil',valid_until,
    'duplicateSubscription',active_count>1,'storageLimitBytes',case when active_count>0 then 5368709120::bigint else 0 end);
end $$;
create function public.bandal_subscription_status() returns jsonb language sql stable security definer set search_path='' as $$
  select public.bandal_subscription_status_for(auth.uid())
$$;

create or replace function public.bandal_sync_access_for(actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare enabled boolean; paid jsonb; source text := 'none'; allowed boolean := false; begin
  if actor is null then raise exception 'sync_authentication_required' using errcode='42501'; end if;
  select enforce_paid_access into strict enabled from public.bandal_sync_configuration where singleton;
  paid := public.bandal_subscription_status_for(actor);
  if not enabled then source := 'rollout'; allowed := true;
  elsif (paid->>'active')::boolean then source := 'subscription'; allowed := true;
  elsif exists(select 1 from public.bandal_sync_beta_access where user_id=actor and expires_at>now()) then source := 'beta'; allowed := true;
  end if;
  return jsonb_build_object('writeAllowed',allowed,'accessSource',source,'enforcePaidAccess',enabled,
    'storageLimitBytes',case when allowed then 5368709120::bigint else 0 end,'paidThrough',paid->'validUntil');
end $$;

create function public.apple_billing_prepare(actor uuid,env text) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid; begin
  if actor is null or env not in ('production','sandbox') then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(case when env='production' then 'live' else 'sandbox' end || actor::text,810));
  if env='production' and ((public.bandal_subscription_status_for(actor)->>'active')::boolean
    or exists(select 1 from public.paddle_billing_subscriptions where user_id=actor and environment='live' and status in ('pending','active','past_due','paused','trialing'))) then
    raise exception 'subscription_exists';
  end if;
  if exists(select 1 from public.paddle_billing_checkouts where user_id=actor and environment=case when env='production' then 'live' else 'sandbox' end
    and (state='ready' or (state='creating' and created_at>now()-interval '15 minutes'))) then raise exception 'checkout_in_progress'; end if;
  insert into public.apple_billing_accounts(user_id,purchase_pending_until) values(actor,case when env='production' then now()+interval '15 minutes' end)
    on conflict(user_id) do update set purchase_pending_until=case when env='production' then now()+interval '15 minutes' else apple_billing_accounts.purchase_pending_until end
    returning app_account_token into token;
  return token;
end $$;

-- One transaction commits event deduplication, immutable ownership and current
-- verified Apple state. Only the server verifier may call this function.
create function public.apple_billing_apply(actor uuid,env text,event_input text,hash_input text,snapshot jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare token uuid; owner uuid; prior public.apple_billing_subscriptions; txn public.apple_billing_transactions; old_hash text; begin
  if env not in ('production','sandbox') or event_input is null or length(event_input)>160 or hash_input !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(env || event_input,811));
  select payload_hash into old_hash from public.apple_billing_events where environment=env and event_id=event_input;
  if found then
    if old_hash<>hash_input then raise exception 'event_payload_mismatch'; end if;
    return 'duplicate';
  end if;
  if snapshot is not null then
    token := (snapshot->>'appAccountToken')::uuid;
    select user_id into owner from public.apple_billing_accounts where app_account_token=token;
    if not found then raise exception 'apple_account_token_required'; end if;
    if owner is null then
      if actor is not null then raise exception 'account_deleted'; end if;
      insert into public.apple_billing_events(environment,event_id,payload_hash) values(env,event_input,hash_input);
      return 'ignored_deleted_account';
    end if;
    if actor is not null and actor<>owner then raise exception 'purchase_owned_by_another_account'; end if;
    perform pg_advisory_xact_lock(hashtextextended(case when env='production' then 'live' else 'sandbox' end || owner::text,810));
    select * into prior from public.apple_billing_subscriptions where environment=env and original_transaction_id=snapshot->>'originalTransactionId' for update;
    if found and prior.app_account_token<>token then raise exception 'purchase_owned_by_another_account'; end if;
    select * into txn from public.apple_billing_transactions where environment=env and transaction_id=snapshot->>'transactionId' for update;
    if found and (txn.app_account_token<>token or txn.original_transaction_id<>snapshot->>'originalTransactionId' or txn.product_id<>snapshot->>'productId') then
      raise exception 'apple_transaction_mismatch';
    end if;
    insert into public.apple_billing_transactions(environment,transaction_id,original_transaction_id,app_account_token,product_id,purchased_at,expires_at,revoked_at,revocation_type,revocation_percentage,signed_at)
    values(env,snapshot->>'transactionId',snapshot->>'originalTransactionId',token,snapshot->>'productId',(snapshot->>'purchasedAt')::timestamptz,(snapshot->>'expiresAt')::timestamptz,
      (snapshot->>'revokedAt')::timestamptz,snapshot->>'revocationType',(snapshot->>'revocationPercentage')::integer,(snapshot->>'signedAt')::timestamptz)
    on conflict(environment,transaction_id) do update set revoked_at=excluded.revoked_at,revocation_type=excluded.revocation_type,revocation_percentage=excluded.revocation_percentage,
      expires_at=excluded.expires_at,signed_at=excluded.signed_at where excluded.signed_at>apple_billing_transactions.signed_at;
    insert into public.apple_billing_subscriptions(environment,original_transaction_id,app_account_token,product_id,plan,status,expires_at,grace_expires_at,auto_renew,revoked_at,signed_at)
    values(env,snapshot->>'originalTransactionId',token,snapshot->>'productId',snapshot->>'plan',(snapshot->>'status')::integer,(snapshot->>'expiresAt')::timestamptz,
      (snapshot->>'graceExpiresAt')::timestamptz,(snapshot->>'autoRenew')::boolean,(snapshot->>'revokedAt')::timestamptz,(snapshot->>'signedAt')::timestamptz)
    on conflict(environment,original_transaction_id) do update set product_id=excluded.product_id,plan=excluded.plan,status=excluded.status,expires_at=excluded.expires_at,
      grace_expires_at=excluded.grace_expires_at,auto_renew=excluded.auto_renew,revoked_at=excluded.revoked_at,signed_at=excluded.signed_at
      where excluded.signed_at>apple_billing_subscriptions.signed_at;
    if env='production' then update public.apple_billing_accounts set purchase_pending_until=null where app_account_token=token; end if;
  end if;
  insert into public.apple_billing_events(environment,event_id,payload_hash) values(env,event_input,hash_input);
  return 'applied';
end $$;

alter function public.paddle_billing_reserve_checkout(uuid,text,uuid,text) rename to paddle_billing_reserve_checkout_original;
revoke all on function public.paddle_billing_reserve_checkout_original(uuid,text,uuid,text) from public,anon,authenticated,service_role;
create function public.paddle_billing_reserve_checkout(actor uuid,plan_input text,request_key uuid,env text) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(env || actor::text,810));
  if env='live' then
    if (public.bandal_subscription_status_for(actor)->>'active')::boolean then raise exception 'subscription_exists'; end if;
    if exists(select 1 from public.apple_billing_accounts where user_id=actor and purchase_pending_until>now()) then raise exception 'checkout_in_progress'; end if;
  end if;
  return public.paddle_billing_reserve_checkout_original(actor,plan_input,request_key,env);
end $$;

revoke all on function public.bandal_subscription_status_for(uuid),public.bandal_subscription_status(),public.apple_billing_prepare(uuid,text),public.apple_billing_apply(uuid,text,text,text,jsonb),public.paddle_billing_reserve_checkout(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.bandal_subscription_status() to authenticated;
grant execute on function public.bandal_subscription_status_for(uuid),public.bandal_subscription_status(),public.apple_billing_prepare(uuid,text),public.apple_billing_apply(uuid,text,text,text,jsonb),public.paddle_billing_reserve_checkout(uuid,text,uuid,text) to service_role;
commit;
