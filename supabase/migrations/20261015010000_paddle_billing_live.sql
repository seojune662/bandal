-- Keep Sandbox records and their composite keys intact; Live is a separate
-- environment with its own catalog, customer ownership, payments and receipts.
do $$ declare t text; begin
  foreach t in array array['catalog','checkouts','customers','subscriptions','payments','events'] loop
    execute format('alter table public.paddle_billing_%I drop constraint paddle_billing_%s_environment_check',t,t);
    execute format('alter table public.paddle_billing_%I add constraint paddle_billing_%s_environment_check check(environment in (''sandbox'',''live''))',t,t);
  end loop;
end $$;

-- Verified Paddle Live catalog: pro_01m4zcnhpwxmem4p8fq6z6kcw7, tax-inclusive KRW, quantity one, no trial.
insert into public.paddle_billing_catalog(environment,price_id,plan,amount) values
 ('live','pri_01m4zcnj1x9cjr5wabtxsfr85z','monthly',4900),
 ('live','pri_01m4zcnjb4v9n8zea01hmk2x8j','annual',49000);

create or replace function public.paddle_billing_reserve_checkout(actor uuid, plan_input text, request_key uuid, env text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.paddle_billing_checkouts; p public.paddle_billing_catalog; begin
  if env not in ('sandbox','live') or actor is null or request_key is null then raise exception 'invalid_billing_environment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(env || actor::text,810));
  select * into strict p from public.paddle_billing_catalog where environment=env and plan=plan_input;
  select * into c from public.paddle_billing_checkouts where environment=env and user_id=actor and request_id=request_key;
  if found then
    if c.plan <> plan_input then raise exception 'request_id_reused'; end if;
    return to_jsonb(c) || jsonb_build_object('created',false);
  end if;
  if exists(select 1 from public.paddle_billing_subscriptions where environment=env and user_id=actor and status in ('pending','active','past_due','paused','trialing')) then raise exception 'subscription_exists'; end if;
  -- No transaction was returned for an interrupted creation. A new request
  -- may retry after the bounded provider request has certainly ended.
  update public.paddle_billing_checkouts set state='failed' where environment=env and user_id=actor and state='creating' and transaction_id is null and created_at < now()-interval '15 minutes';
  select * into c from public.paddle_billing_checkouts where environment=env and user_id=actor and state in ('creating','ready');
  if found then
    if c.plan <> plan_input then raise exception 'checkout_plan_already_pending'; end if;
    return to_jsonb(c) || jsonb_build_object('created',false);
  end if;
  insert into public.paddle_billing_checkouts(environment,user_id,request_id,price_id,plan)
    values(env,actor,request_key,p.price_id,p.plan) returning * into c;
  return to_jsonb(c) || jsonb_build_object('created',true);
end $$;

create or replace function public.paddle_billing_bind_checkout(checkout_input uuid, transaction_input text, env text)
returns public.paddle_billing_checkouts language plpgsql security definer set search_path='' as $$
declare c public.paddle_billing_checkouts; begin
  select * into strict c from public.paddle_billing_checkouts where id=checkout_input and environment=env for update;
  if c.transaction_id is not null and c.transaction_id <> transaction_input then raise exception 'checkout_binding_mismatch'; end if;
  if c.state not in ('creating','ready') then raise exception 'checkout_not_ready'; end if;
  update public.paddle_billing_checkouts set transaction_id=transaction_input,state='ready' where id=c.id returning * into c;
  return c;
end $$;

-- The event receipt, immutable ownership, paid period and subscription state are
-- committed in the same transaction. No grant can survive a failed validation.
create or replace function public.paddle_billing_apply_event(
  env text,event_input text,event_type_input text,occurred_input timestamptz,hash_input text,
  subscription_input jsonb default null,payment_input jsonb default null,origin_transaction_input text default null
) returns text language plpgsql security definer set search_path='' as $$
declare
  s public.paddle_billing_subscriptions; c public.paddle_billing_checkouts; p public.paddle_billing_catalog;
  customer public.paddle_billing_customers; existing_payment public.paddle_billing_payments; event_hash text;
  sub_id text; customer_id_input text; price_id_input text; actor uuid; source_updated timestamptz;
begin
  if env not in ('sandbox','live') or occurred_input is null then raise exception 'invalid_billing_environment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(env || event_input,811));
  select payload_hash into event_hash from public.paddle_billing_events where environment=env and event_id=event_input;
  if found then
    if event_hash <> hash_input then raise exception 'event_payload_mismatch'; end if;
    return 'duplicate';
  end if;
  sub_id := coalesce(subscription_input->>'id',payment_input->>'subscription_id');
  customer_id_input := coalesce(subscription_input->>'customer_id',payment_input->>'customer_id');
  price_id_input := coalesce(subscription_input->>'price_id',payment_input->>'price_id');
  if sub_id is null then raise exception 'subscription_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(env || sub_id,812));
  select * into strict p from public.paddle_billing_catalog where environment=env and price_id=price_id_input;
  select * into s from public.paddle_billing_subscriptions where environment=env and subscription_id=sub_id for update;
  if found then
    actor := s.user_id;
    if s.customer_id <> customer_id_input or s.price_id <> price_id_input then raise exception 'subscription_mismatch'; end if;
  end if;
  select * into c from public.paddle_billing_checkouts
    where environment=env and transaction_id=coalesce(origin_transaction_input,payment_input->>'id') for update;
  if found then
    if c.price_id <> price_id_input or (actor is not null and actor <> c.user_id) then raise exception 'checkout_binding_mismatch'; end if;
    actor := c.user_id;
  end if;
  if actor is null then raise exception 'checkout_binding_pending'; end if;
  -- Account ownership is assigned only from our stored transaction binding.
  -- Neither provider email nor custom_data participates in this lookup.
  perform pg_advisory_xact_lock(hashtextextended(env || actor::text,810));
  select * into customer from public.paddle_billing_customers where environment=env and customer_id=customer_id_input;
  if found and customer.user_id <> actor then raise exception 'customer_binding_mismatch'; end if;
  select * into customer from public.paddle_billing_customers where environment=env and user_id=actor;
  if found and customer.customer_id <> customer_id_input then raise exception 'customer_binding_mismatch'; end if;
  insert into public.paddle_billing_customers(environment,customer_id,user_id) values(env,customer_id_input,actor) on conflict do nothing;
  insert into public.paddle_billing_subscriptions(environment,subscription_id,user_id,customer_id,price_id,status)
    values(env,sub_id,actor,customer_id_input,price_id_input,'pending') on conflict do nothing;
  if payment_input is not null then
    if payment_input->>'subscription_id' <> sub_id or payment_input->>'customer_id' <> customer_id_input or payment_input->>'price_id' <> price_id_input
      or payment_input->>'currency' <> 'KRW' or (payment_input->>'amount')::integer <> p.amount
      or (payment_input->>'period_ends_at')::timestamptz <= (payment_input->>'period_starts_at')::timestamptz
      or (payment_input->>'period_ends_at')::timestamptz - (payment_input->>'period_starts_at')::timestamptz > (case p.plan when 'monthly' then interval '32 days' else interval '367 days' end)
    then raise exception 'payment_mismatch'; end if;
    select * into existing_payment from public.paddle_billing_payments where environment=env and transaction_id=payment_input->>'id';
    if found and (existing_payment.subscription_id <> sub_id or existing_payment.customer_id <> customer_id_input or existing_payment.user_id <> actor or existing_payment.price_id <> price_id_input
      or existing_payment.period_starts_at <> (payment_input->>'period_starts_at')::timestamptz or existing_payment.period_ends_at <> (payment_input->>'period_ends_at')::timestamptz) then raise exception 'payment_mismatch'; end if;
    insert into public.paddle_billing_payments(environment,transaction_id,subscription_id,user_id,customer_id,price_id,amount,currency,period_starts_at,period_ends_at)
      values(env,payment_input->>'id',sub_id,actor,customer_id_input,price_id_input,p.amount,'KRW',(payment_input->>'period_starts_at')::timestamptz,(payment_input->>'period_ends_at')::timestamptz)
      on conflict do nothing;
    update public.paddle_billing_checkouts set state='completed' where environment=env and transaction_id=payment_input->>'id';
  end if;
  if subscription_input is not null then
    source_updated := (subscription_input->>'updated_at')::timestamptz;
    if source_updated is null then raise exception 'subscription_mismatch'; end if;
    update public.paddle_billing_subscriptions set
      status=subscription_input->>'status',provider_updated_at=source_updated,event_occurred_at=occurred_input,
      period_starts_at=(subscription_input->>'period_starts_at')::timestamptz,period_ends_at=(subscription_input->>'period_ends_at')::timestamptz,
      scheduled_action=subscription_input->>'scheduled_action',scheduled_at=(subscription_input->>'scheduled_at')::timestamptz
    where environment=env and subscription_id=sub_id
      and (provider_updated_at is null or source_updated > provider_updated_at or (source_updated=provider_updated_at and occurred_input > event_occurred_at))
      and (status <> 'canceled' or subscription_input->>'status'='canceled');
  end if;
  insert into public.paddle_billing_events(environment,event_id,event_type,occurred_at,payload_hash) values(env,event_input,event_type_input,occurred_input,hash_input);
  return 'applied';
end $$;

create function public.paddle_billing_discard_checkout(actor uuid,checkout_input uuid,transaction_input text,env text)
returns void language plpgsql security definer set search_path='' as $$
declare c public.paddle_billing_checkouts; begin
  perform pg_advisory_xact_lock(hashtextextended(env || actor::text,810));
  select * into strict c from public.paddle_billing_checkouts where id=checkout_input and environment=env and user_id=actor for update;
  if c.transaction_id <> transaction_input or c.state not in ('ready','failed') then raise exception 'checkout_not_ready'; end if;
  -- Caller has already obtained the authenticated provider's canceled response.
  -- Do not delete transaction ownership: delayed events must still be checked.
  update public.paddle_billing_checkouts set state='failed' where id=c.id;
end $$;

create table public.paddle_billing_adjustments (
  environment text not null check(environment in ('sandbox','live')),
  adjustment_id text not null check(adjustment_id ~ '^adj_[a-z0-9]{26}$'),
  transaction_id text not null, customer_id text not null,
  action text not null check(action in ('credit','refund','chargeback','chargeback_reverse','chargeback_warning','chargeback_warning_reverse','credit_reverse')),
  status text not null check(status in ('pending_approval','approved','rejected','reversed')),
  amount integer not null check(amount >= 0), currency text not null check(currency='KRW'),
  provider_updated_at timestamptz not null,event_occurred_at timestamptz not null,
  primary key(environment,adjustment_id),
  foreign key(environment,transaction_id) references public.paddle_billing_payments(environment,transaction_id)
);
create index paddle_billing_adjustments_payment on public.paddle_billing_adjustments(environment,transaction_id);
alter table public.paddle_billing_adjustments enable row level security;
revoke all on public.paddle_billing_adjustments from public,anon,authenticated;
grant all on public.paddle_billing_adjustments to service_role;

create function public.paddle_billing_apply_adjustment(
 env text,event_input text,event_type_input text,occurred_input timestamptz,hash_input text,adjustment_input jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare
 p public.paddle_billing_payments; a public.paddle_billing_adjustments; event_hash text; updated_input timestamptz;
begin
 if env not in ('sandbox','live') or occurred_input is null then raise exception 'invalid_billing_environment'; end if;
 perform pg_advisory_xact_lock(hashtextextended(env || event_input,811));
 select payload_hash into event_hash from public.paddle_billing_events where environment=env and event_id=event_input;
 if found then
  if event_hash <> hash_input then raise exception 'event_payload_mismatch'; end if;
  return 'duplicate';
 end if;
 select * into p from public.paddle_billing_payments where environment=env and transaction_id=adjustment_input->>'transaction_id' for update;
 if not found then raise exception 'adjustment_binding_pending'; end if;
 if p.customer_id <> adjustment_input->>'customer_id' or p.currency <> adjustment_input->>'currency'
  or (adjustment_input->>'subscription_id' is not null and p.subscription_id <> adjustment_input->>'subscription_id')
 then raise exception 'adjustment_mismatch'; end if;
 updated_input := (adjustment_input->>'updated_at')::timestamptz;
 select * into a from public.paddle_billing_adjustments where environment=env and adjustment_id=adjustment_input->>'id' for update;
 if found and (a.transaction_id <> p.transaction_id or a.customer_id <> p.customer_id or a.action <> adjustment_input->>'action' or a.amount <> (adjustment_input->>'amount')::integer)
 then raise exception 'adjustment_mismatch'; end if;
 insert into public.paddle_billing_adjustments(environment,adjustment_id,transaction_id,customer_id,action,status,amount,currency,provider_updated_at,event_occurred_at)
 values(env,adjustment_input->>'id',p.transaction_id,p.customer_id,adjustment_input->>'action',adjustment_input->>'status',(adjustment_input->>'amount')::integer,'KRW',updated_input,occurred_input)
 on conflict(environment,adjustment_id) do update set status=excluded.status,provider_updated_at=excluded.provider_updated_at,event_occurred_at=excluded.event_occurred_at
 where (excluded.provider_updated_at > paddle_billing_adjustments.provider_updated_at
   or (excluded.provider_updated_at = paddle_billing_adjustments.provider_updated_at and excluded.event_occurred_at > paddle_billing_adjustments.event_occurred_at))
  and paddle_billing_adjustments.status <> 'reversed'
  and not (paddle_billing_adjustments.status in ('approved','rejected') and excluded.status='pending_approval');
 insert into public.paddle_billing_events(environment,event_id,event_type,occurred_at,payload_hash) values(env,event_input,event_type_input,occurred_input,hash_input);
 return 'applied';
end $$;

-- Recovery reads the provider using stored account/transaction bindings. The
-- original payment, subscription state and all returned adjustments are atomic.
create function public.paddle_billing_apply_reconciliation(
 env text,event_input text,occurred_input timestamptz,hash_input text,
 subscription_input jsonb,payment_input jsonb,origin_transaction_input text,adjustments_input jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb; i integer := 0; begin
 if jsonb_typeof(adjustments_input) <> 'array' then raise exception 'adjustment_mismatch'; end if;
 perform public.paddle_billing_apply_event(env,event_input,'api.refresh',occurred_input,hash_input,subscription_input,payment_input,origin_transaction_input);
 for a in select value from jsonb_array_elements(adjustments_input) loop
  i := i+1;
  if a->>'transaction_id' <> payment_input->>'id' then raise exception 'adjustment_mismatch'; end if;
  perform public.paddle_billing_apply_adjustment(env,event_input || '_adjustment_' || i::text,'api.refresh.adjustment',occurred_input,hash_input,a);
 end loop;
end $$;

create or replace function public.paddle_billing_status(actor uuid,env text)
returns jsonb language sql stable security definer set search_path='' as $$
 with candidates as (
  select s.*,c.plan,
   (select max(p.period_ends_at) from public.paddle_billing_payments p
    where p.environment=s.environment and p.subscription_id=s.subscription_id and p.period_starts_at <= now()
    and not exists(select 1 from public.paddle_billing_adjustments a where a.environment=p.environment and a.transaction_id=p.transaction_id
      and a.status='approved' and a.action in ('chargeback','chargeback_warning'))
    and coalesce((select sum(a.amount) from public.paddle_billing_adjustments a where a.environment=p.environment and a.transaction_id=p.transaction_id
      and a.status='approved' and a.action in ('refund','credit')),0) < p.amount
   ) as paid_through
  from public.paddle_billing_subscriptions s join public.paddle_billing_catalog c using(environment,price_id)
  where s.environment=env and s.user_id=actor and env in ('sandbox','live')
 ), entitlement as (
  select *, status='active' and paid_through > now()
   and (scheduled_action is null or scheduled_action='resume' or scheduled_at > now()) as active
  from candidates order by (status='active') desc,created_at desc limit 1
 )
 select coalesce((select jsonb_build_object(
  'active',coalesce(active,false),'status',status,'plan',plan,
  'paidThrough',case when paid_through is null then null when scheduled_action in ('cancel','pause') then least(paid_through,scheduled_at) else paid_through end,
  'cancelAtPeriodEnd',coalesce(scheduled_action='cancel',false),'storageBytes',case when active then 5368709120::bigint else 0 end
 ) from entitlement),jsonb_build_object('active',false,'status','none','plan',null,'paidThrough',null,'cancelAtPeriodEnd',false,'storageBytes',0))
 || jsonb_build_object('canManageBilling',exists(select 1 from public.paddle_billing_customers where environment=env and user_id=actor));
$$;

revoke all on function public.paddle_billing_discard_checkout(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.paddle_billing_apply_adjustment(text,text,text,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.paddle_billing_apply_reconciliation(text,text,timestamptz,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.paddle_billing_discard_checkout(uuid,uuid,text,text) to service_role;
grant execute on function public.paddle_billing_apply_adjustment(text,text,text,timestamptz,text,jsonb) to service_role;
grant execute on function public.paddle_billing_apply_reconciliation(text,text,timestamptz,text,jsonb,jsonb,text,jsonb) to service_role;
