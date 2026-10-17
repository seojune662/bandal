begin;
-- A durable job prevents uploads/pushes while a deletion is retried. No email,
-- display name, raw token or file contents are retained in this receipt.
create table public.bandal_account_deletions (
  user_id uuid primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.bandal_apple_authorizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.bandal_account_deletions enable row level security;
alter table public.bandal_apple_authorizations enable row level security;
revoke all on public.bandal_account_deletions,public.bandal_apple_authorizations from public,anon,authenticated;
grant all on public.bandal_account_deletions,public.bandal_apple_authorizations to service_role;

-- Preserve provider identifiers so a deleted account's payment can never be
-- adopted by a newly registered account. Do not retain its auth relationship.
do $$ declare t text; r record; begin
  foreach t in array array['paddle_billing_checkouts','paddle_billing_customers','paddle_billing_subscriptions','paddle_billing_payments'] loop
    for r in select conname from pg_constraint where conrelid=to_regclass('public.'||t) and confrelid='auth.users'::regclass and contype='f' loop
      execute format('alter table public.%I drop constraint %I',t,r.conname);
    end loop;
    execute format('alter table public.%I alter column user_id drop not null',t);
    execute format('alter table public.%I add foreign key(user_id) references auth.users(id) on delete set null',t);
  end loop;
  -- Shared group/board owners may disappear. Other members keep their work.
  for r in select * from (values ('study_groups','owner_id','public.profiles'),('whiteboards','created_by','auth.users'),
    ('marketplace_publishers','user_id','auth.users'),('marketplace_releases','reviewed_by','auth.users'),
    ('marketplace_audit','actor','auth.users'),('study_market_orders','buyer_id','auth.users'),('study_market_audit','actor','auth.users')) v(t,c,ref) loop
    if to_regclass('public.'||r.t) is null then continue; end if;
    execute format('alter table public.%I alter column %I drop not null',r.t,r.c);
    for t in select conname from pg_constraint where conrelid=to_regclass('public.'||r.t) and confrelid=to_regclass(r.ref) and contype='f' loop
      execute format('alter table public.%I drop constraint %I',r.t,t);
    end loop;
    execute format('alter table public.%I add foreign key(%I) references %s(id) on delete set null',r.t,r.c,r.ref);
  end loop;
  -- A seller ledger UUID is a non-reusable financial identity, not a login.
  -- Settled transactions retain their references after the auth row is removed.
  if to_regclass('public.study_market_sellers') is not null then
    for t in select conname from pg_constraint where conrelid='public.study_market_sellers'::regclass and confrelid='auth.users'::regclass and contype='f' loop
      execute format('alter table public.study_market_sellers drop constraint %I',t);
    end loop;
  end if;
end $$;

create function public.bandal_account_write_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare actors uuid[] := array[auth.uid()]; actor uuid; row_data jsonb := to_jsonb(new); field text; financial_update boolean := false; begin
  -- Include server-created objects in the freeze. Locking serializes an in-flight
  -- write with deletion_begin, so it cannot commit after the deletion scan.
  if tg_table_schema='storage' then
    if new.owner is not null then actors:=array_append(actors,new.owner); end if;
    if new.owner_id ~ '^[0-9a-fA-F-]{36}$' then actors:=array_append(actors,new.owner_id::uuid); end if;
    if new.bucket_id='bandal-assets' and split_part(new.name,'/',1) ~ '^[0-9a-fA-F-]{36}$' then actors:=array_append(actors,split_part(new.name,'/',1)::uuid); end if;
  elsif tg_table_name in ('bandal_records','bandal_operations','bandal_changes','apple_billing_accounts','paddle_billing_checkouts','paddle_billing_customers','paddle_billing_subscriptions','paddle_billing_payments') then
    actors:=array_append(actors,(row_data->>'user_id')::uuid);
  elsif tg_op='UPDATE' and tg_table_name in ('study_market_orders','study_market_payouts') and row_data->>'status' is distinct from to_jsonb(old)->>'status' then
    financial_update := true;
    foreach field in array array['buyer_id','seller_id'] loop
      if row_data ? field then actors:=array_append(actors,(row_data->>field)::uuid); end if;
    end loop;
  elsif tg_op='INSERT' and tg_table_name in ('study_market_orders','study_market_listings','study_market_payouts','marketplace_publishers','group_members','whiteboards','whiteboard_shapes','whiteboard_assets') then
    foreach field in array array['buyer_id','seller_id','user_id','created_by','author_id'] loop
      if row_data ? field then actors:=array_append(actors,(row_data->>field)::uuid); end if;
    end loop;
  end if;
  for actor in select distinct value from unnest(actors) value where value is not null order by value loop
    perform pg_advisory_xact_lock_shared(hashtextextended(actor::text,812));
    if exists(select 1 from public.bandal_account_deletions where user_id=actor and (not financial_update or actor=auth.uid() or completed_at is null)) then raise exception 'account_deletion_in_progress' using errcode='42501'; end if;
  end loop;
  return new;
end $$;
-- Freeze authenticated writes in all current public tables, including writes
-- from SECURITY DEFINER RPCs (auth.uid still identifies the caller).
do $$ declare t record; begin
  for t in select schemaname,tablename from pg_tables where schemaname='public' and tablename not in ('bandal_account_deletions','bandal_apple_authorizations') loop
    execute format('create trigger account_deletion_write_guard before insert or update on %I.%I for each row execute function public.bandal_account_write_guard()',t.schemaname,t.tablename);
  end loop;
end $$;
create trigger account_deletion_write_guard before insert or update on storage.objects for each row execute function public.bandal_account_write_guard();

create function public.bandal_account_deletion_begin(actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare pending jsonb; begin
  if actor is null or not exists(select 1 from auth.users where id=actor) then raise exception 'sign_in_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,812));
  -- The product policy blocks only unsettled transactions. Completed history is
  -- anonymized below; it never requires contacting support to delete an account.
  if to_regclass('public.study_market_orders') is not null then
    execute $query$select jsonb_build_object(
      'orders',coalesce((select jsonb_agg(to_jsonb(x)) from (
        select case when buyer_id=$1 then 'buyer' else 'seller' end as role,status,count(*) as count
        from public.study_market_orders where (buyer_id=$1 or seller_id=$1) and status in ('pending','refund_pending','refund_due','review') group by 1,2
      ) x),'[]'::jsonb),
      'payouts',coalesce((select jsonb_agg(to_jsonb(x)) from (
        select status,count(*) as count from public.study_market_payouts where seller_id=$1 and status in ('reserved','requested','review') group by 1
      ) x),'[]'::jsonb),
      'cases',coalesce((select jsonb_agg(to_jsonb(x)) from (select kind,status,count(*) as count from public.study_market_cases where user_id=$1 and kind in ('refund','receivable') and status='open' group by 1,2) x),'[]'::jsonb),
      'unsettledBalance',coalesce((select sum(amount) from public.study_market_ledger where seller_id=$1 and payout_id is null),0)
    )$query$ into pending using actor;
    if jsonb_array_length(pending->'orders')>0 or jsonb_array_length(pending->'payouts')>0 or jsonb_array_length(pending->'cases')>0 or (pending->>'unsettledBalance')::bigint<>0 then
      return jsonb_build_object('started',false,'pendingTransactions',pending);
    end if;
  end if;
  insert into public.bandal_account_deletions(user_id) values(actor) on conflict do nothing;
  return jsonb_build_object('started',true);
end $$;
create function public.bandal_account_deletion_assets(actor uuid) returns table(bucket_id text,name text)
language sql stable security definer set search_path='' as $$
  select o.bucket_id,o.name from storage.objects o
  where exists(select 1 from public.bandal_account_deletions where user_id=actor and completed_at is null)
    and (o.owner_id=actor::text or o.owner=actor or (o.bucket_id='bandal-assets' and split_part(o.name,'/',1)=actor::text))
  order by o.bucket_id,o.name limit 100
$$;
-- Older whiteboard uploads may be service-owned. Their metadata is an additional
-- ownership source, whereas unrelated members' assets are never selected.
do $$ begin
  if to_regclass('public.whiteboard_assets') is not null then
    execute $fn$create or replace function public.bandal_account_deletion_assets(actor uuid) returns table(bucket_id text,name text)
      language sql stable security definer set search_path='' as $body$
      select o.bucket_id,o.name from storage.objects o
      where exists(select 1 from public.bandal_account_deletions where user_id=actor and completed_at is null)
        and (o.owner_id=actor::text or o.owner=actor or (o.bucket_id='bandal-assets' and split_part(o.name,'/',1)=actor::text)
          or (o.bucket_id='whiteboard-assets' and exists(select 1 from public.whiteboard_assets a where a.author_id=actor and a.storage_path=o.name)))
      order by o.bucket_id,o.name limit 100 $body$ $fn$;
  end if;
end $$;
create function public.bandal_account_deletion_cleanup(actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record; next_owner uuid; begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text,812));
  if not exists(select 1 from public.bandal_account_deletions where user_id=actor and completed_at is null) then raise exception 'account_deletion_not_started'; end if;
  if exists(select 1 from public.bandal_account_deletion_assets(actor)) then raise exception 'account_deletion_storage_pending'; end if;
  -- Transfer live groups to another active member, or disband an empty group.
  if to_regclass('public.study_groups') is not null then
    for r in execute 'select id from public.study_groups where owner_id=$1 for update' using actor loop
      execute 'select user_id from public.group_members where group_id=$1 and user_id<>$2 and left_at is null order by (role=''admin'') desc,joined_at,user_id limit 1' into next_owner using r.id,actor;
      execute 'update public.study_groups set owner_id=$2,deleted_at=case when $2 is null then coalesce(deleted_at,now()) else deleted_at end where id=$1' using r.id,next_owner;
      if next_owner is not null then execute 'update public.group_members set role=''owner'' where group_id=$1 and user_id=$2' using r.id,next_owner; end if;
    end loop;
    execute 'update public.messages set reply_to=null where reply_to in (select id from public.messages where author_id=$1)' using actor;
  end if;
  for r in select * from (values
    ('messages','author_id=$1'),('group_members','user_id=$1'),('group_invites','invitee_id=$1 or inviter_id=$1'),
    ('invite_codes','created_by=$1'),('friendships','user_a=$1 or user_b=$1 or requested_by=$1'),
    ('blocks','blocker_id=$1 or blocked_id=$1'),('reports','reporter_id=$1'),('rate_events','user_id=$1'),
    ('whiteboard_shapes','author_id=$1'),('whiteboard_assets','author_id=$1'),('feedback','user_id=$1'),
    ('marketplace_reports','user_id=$1'),('marketplace_reviewers','user_id=$1'),
    ('study_market_members','user_id=$1'),('study_market_operators','user_id=$1'),('study_market_reports','user_id=$1'),('study_market_cases','user_id=$1')
  ) v(t,condition) loop
    if to_regclass('public.'||r.t) is not null then execute format('delete from public.%I where %s',r.t,r.condition) using actor; end if;
  end loop;
  if to_regclass('public.marketplace_publishers') is not null then
    execute 'update public.marketplace_publishers set display_name=''삭제된 계정'' where user_id=$1' using actor;
    execute 'update public.marketplace_audit set reason='''' where actor=$1' using actor;
    execute 'update public.marketplace_releases set review_reason='''' where reviewed_by=$1' using actor;
  end if;
  if to_regclass('public.study_market_sellers') is not null then
    execute 'update public.study_market_sellers set display_name=''삭제된 계정'',status=''deleted'',held=true where user_id=$1' using actor;
    execute 'update public.study_market_listings set status=''paused'' where seller_id=$1' using actor;
    execute 'update public.study_market_audit set reason='''' where actor=$1' using actor;
    execute 'update public.study_market_orders set refund_reason=null,receipt_url=null where buyer_id=$1' using actor;
  end if;
  -- Cascades remove profile, personal sync records, beta grants and usage when
  -- the Edge function finally calls Auth deleteUser, after all Storage API calls.
end $$;

create function public.bandal_apple_authorization_store(actor uuid,ciphertext_input text,iv_input text) returns void
language plpgsql security definer set search_path='' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text,812));
  if exists(select 1 from public.bandal_account_deletions where user_id=actor) then raise exception 'account_deletion_in_progress'; end if;
  if actor is null or length(ciphertext_input)>24000 or length(iv_input)<>16 then raise exception 'invalid_request'; end if;
  insert into public.bandal_apple_authorizations(user_id,ciphertext,iv) values(actor,ciphertext_input,iv_input)
    on conflict(user_id) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,revoked_at=null,updated_at=now();
end $$;
revoke all on function public.bandal_apple_authorization_store(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bandal_apple_authorization_store(uuid,text,text) to service_role;

-- Status and server-created checkout reservations also respect the freeze.
alter function public.bandal_sync_access_for(uuid) rename to bandal_sync_access_before_deletion;
revoke all on function public.bandal_sync_access_before_deletion(uuid) from public,anon,authenticated,service_role;
create function public.bandal_sync_access_for(actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if exists(select 1 from public.bandal_account_deletions where user_id=actor) then
    return public.bandal_sync_access_before_deletion(actor)||jsonb_build_object('writeAllowed',false,'accessSource','none','storageLimitBytes',0);
  end if;
  return public.bandal_sync_access_before_deletion(actor);
end $$;
revoke all on function public.bandal_sync_access_for(uuid) from public,anon,authenticated;
grant execute on function public.bandal_sync_access_for(uuid) to service_role;

-- An old Paddle customer binding with a NULL user is retired, not unclaimed.
alter function public.paddle_billing_apply_event(text,text,text,timestamptz,text,jsonb,jsonb,text) rename to paddle_billing_apply_event_original;
revoke all on function public.paddle_billing_apply_event_original(text,text,text,timestamptz,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;
create function public.paddle_billing_apply_event(env text,event_input text,event_type_input text,occurred_input timestamptz,hash_input text,subscription_input jsonb default null,payment_input jsonb default null,origin_transaction_input text default null)
returns text language plpgsql security definer set search_path='' as $$ declare customer text := coalesce(subscription_input->>'customer_id',payment_input->>'customer_id'); old_hash text; retired_checkout boolean; begin
  select exists(select 1 from public.paddle_billing_checkouts where environment=env and transaction_id=coalesce(origin_transaction_input,payment_input->>'id') and user_id is null) into retired_checkout;
  if retired_checkout or exists(select 1 from public.paddle_billing_customers where environment=env and customer_id=customer and user_id is null) then
    if exists(select 1 from public.paddle_billing_checkouts where environment=env and transaction_id=coalesce(origin_transaction_input,payment_input->>'id') and user_id is not null) then raise exception 'account_deleted'; end if;
    if retired_checkout then
      insert into public.paddle_billing_customers(environment,customer_id,user_id) values(env,customer,null) on conflict do nothing;
    end if;
    if exists(select 1 from public.paddle_billing_customers where environment=env and customer_id=customer and user_id is not null) then raise exception 'account_deleted'; end if;
    perform pg_advisory_xact_lock(hashtextextended(env||event_input,811));
    select payload_hash into old_hash from public.paddle_billing_events where environment=env and event_id=event_input;
    if found and old_hash<>hash_input then raise exception 'event_payload_mismatch'; end if;
    insert into public.paddle_billing_events(environment,event_id,event_type,occurred_at,payload_hash) values(env,event_input,event_type_input,occurred_input,hash_input) on conflict do nothing;
    return 'ignored_deleted_account';
  end if;
  return public.paddle_billing_apply_event_original(env,event_input,event_type_input,occurred_input,hash_input,subscription_input,payment_input,origin_transaction_input);
end $$;
revoke all on function public.bandal_account_write_guard(),public.bandal_account_deletion_begin(uuid),public.bandal_account_deletion_assets(uuid),public.bandal_account_deletion_cleanup(uuid),public.paddle_billing_apply_event(text,text,text,timestamptz,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.bandal_account_deletion_begin(uuid),public.bandal_account_deletion_assets(uuid),public.bandal_account_deletion_cleanup(uuid),public.paddle_billing_apply_event(text,text,text,timestamptz,text,jsonb,jsonb,text) to service_role;
commit;
