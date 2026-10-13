-- An isolated Sandbox billing mirror. Nothing in production sync reads these
-- tables. The environment check deliberately prevents enabling Live by secret.
create table public.paddle_billing_catalog (
  environment text not null check(environment = 'sandbox'),
  price_id text not null, plan text not null check(plan in ('monthly','annual')),
  amount integer not null check(amount > 0), primary key(environment,price_id), unique(environment,plan)
);
insert into public.paddle_billing_catalog values
 ('sandbox','pri_01m4tkfz9fnqcsq4ah67e092j8','monthly',4900),
 ('sandbox','pri_01m4tkhwzp9bhpq2yt03em2c7g','annual',49000);
create table public.paddle_billing_checkouts (
  id uuid primary key default gen_random_uuid(), environment text not null check(environment = 'sandbox'),
  user_id uuid not null references auth.users(id), request_id uuid not null,
  price_id text not null, plan text not null check(plan in ('monthly','annual')),
  transaction_id text check(transaction_id ~ '^txn_[a-z0-9]{26}$'),
  state text not null default 'creating' check(state in ('creating','ready','completed','failed')),
  created_at timestamptz not null default now(),
  unique(environment,user_id,request_id), unique(environment,transaction_id),
  foreign key(environment,price_id) references public.paddle_billing_catalog(environment,price_id)
);
-- A retry or a second tab must reuse the outstanding checkout, not charge twice.
create unique index paddle_billing_one_checkout on public.paddle_billing_checkouts(environment,user_id) where state in ('creating','ready');
create table public.paddle_billing_customers (
  environment text not null check(environment = 'sandbox'), customer_id text not null check(customer_id ~ '^ctm_[a-z0-9]{26}$'),
  user_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
  primary key(environment,customer_id), unique(environment,user_id)
);
create table public.paddle_billing_subscriptions (
  environment text not null check(environment = 'sandbox'), subscription_id text not null check(subscription_id ~ '^sub_[a-z0-9]{26}$'),
  user_id uuid not null references auth.users(id), customer_id text not null, price_id text not null,
  status text not null check(status in ('pending','active','past_due','paused','canceled','trialing')),
  provider_updated_at timestamptz, event_occurred_at timestamptz,
  period_starts_at timestamptz, period_ends_at timestamptz,
  scheduled_action text check(scheduled_action in ('cancel','pause','resume')), scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(environment,subscription_id),
  foreign key(environment,customer_id) references public.paddle_billing_customers(environment,customer_id),
  foreign key(environment,price_id) references public.paddle_billing_catalog(environment,price_id),
  check(period_ends_at is null or period_starts_at < period_ends_at),
  check((scheduled_action is null) = (scheduled_at is null))
);
create index paddle_billing_subscriptions_user on public.paddle_billing_subscriptions(environment,user_id);
create table public.paddle_billing_payments (
  environment text not null check(environment = 'sandbox'), transaction_id text not null check(transaction_id ~ '^txn_[a-z0-9]{26}$'),
  subscription_id text not null, user_id uuid not null references auth.users(id), customer_id text not null,
  price_id text not null, amount integer not null check(amount > 0), currency text not null check(currency = 'KRW'),
  period_starts_at timestamptz not null, period_ends_at timestamptz not null,
  created_at timestamptz not null default now(), primary key(environment,transaction_id),
  foreign key(environment,subscription_id) references public.paddle_billing_subscriptions(environment,subscription_id),
  foreign key(environment,price_id) references public.paddle_billing_catalog(environment,price_id),
  check(period_starts_at < period_ends_at)
);
create table public.paddle_billing_events (
  environment text not null check(environment = 'sandbox'), event_id text not null,
  event_type text not null, occurred_at timestamptz not null, payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  processed_at timestamptz not null default now(), primary key(environment,event_id)
);
do $$ declare t text; begin
  foreach t in array array['catalog','checkouts','customers','subscriptions','payments','events'] loop
    execute format('alter table public.paddle_billing_%I enable row level security',t);
    execute format('revoke all on public.paddle_billing_%I from public,anon,authenticated',t);
    execute format('grant all on public.paddle_billing_%I to service_role',t);
  end loop;
end $$;

create function public.paddle_billing_reserve_checkout(actor uuid, plan_input text, request_key uuid, env text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.paddle_billing_checkouts; p public.paddle_billing_catalog; begin
  if env <> 'sandbox' or actor is null or request_key is null then raise exception 'sandbox_only'; end if;
  perform pg_advisory_xact_lock(hashtextextended(env || actor::text,810));
  select * into strict p from public.paddle_billing_catalog where environment=env and plan=plan_input;
  select * into c from public.paddle_billing_checkouts where environment=env and user_id=actor and request_id=request_key;
  if found then
    if c.plan <> plan_input then raise exception 'request_id_reused'; end if;
    return to_jsonb(c) || jsonb_build_object('created',false);
  end if;
  if exists(select 1 from public.paddle_billing_subscriptions where environment=env and user_id=actor and status in ('pending','active','past_due','paused','trialing')) then raise exception 'subscription_exists'; end if;
  select * into c from public.paddle_billing_checkouts where environment=env and user_id=actor and state in ('creating','ready');
  if found then
    if c.plan <> plan_input then raise exception 'checkout_plan_already_pending'; end if;
    return to_jsonb(c) || jsonb_build_object('created',false);
  end if;
  insert into public.paddle_billing_checkouts(environment,user_id,request_id,price_id,plan)
    values(env,actor,request_key,p.price_id,p.plan) returning * into c;
  return to_jsonb(c) || jsonb_build_object('created',true);
end $$;

create function public.paddle_billing_bind_checkout(checkout_input uuid, transaction_input text, env text)
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
create function public.paddle_billing_apply_event(
  env text,event_input text,event_type_input text,occurred_input timestamptz,hash_input text,
  subscription_input jsonb default null,payment_input jsonb default null,origin_transaction_input text default null
) returns text language plpgsql security definer set search_path='' as $$
declare
  s public.paddle_billing_subscriptions; c public.paddle_billing_checkouts; p public.paddle_billing_catalog;
  customer public.paddle_billing_customers; existing_payment public.paddle_billing_payments; event_hash text;
  sub_id text; customer_id_input text; price_id_input text; actor uuid; source_updated timestamptz;
begin
  if env <> 'sandbox' or occurred_input is null then raise exception 'sandbox_only'; end if;
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

create function public.paddle_billing_status(actor uuid,env text)
returns jsonb language sql stable security definer set search_path='' as $$
  with candidates as (
    select s.*,c.plan,
      (select max(p.period_ends_at) from public.paddle_billing_payments p where p.environment=s.environment and p.subscription_id=s.subscription_id and p.period_starts_at <= now()) as paid_through
    from public.paddle_billing_subscriptions s join public.paddle_billing_catalog c using(environment,price_id)
    where s.environment=env and s.user_id=actor and env='sandbox'
  ), entitlement as (
    select *, status='active' and paid_through > now()
      and (scheduled_action is null or scheduled_action='resume' or scheduled_at > now()) as active
    from candidates order by (status='active') desc,created_at desc limit 1
  )
  select coalesce((select jsonb_build_object(
    'active',coalesce(active,false),'status',status,'plan',plan,
    'paidThrough',case when paid_through is null then null when scheduled_action in ('cancel','pause') then least(paid_through,scheduled_at) else paid_through end,
    'cancelAtPeriodEnd',coalesce(scheduled_action='cancel',false),'storageBytes',case when active then 5368709120::bigint else 0 end
  ) from entitlement),jsonb_build_object('active',false,'status','none','plan',null,'paidThrough',null,'cancelAtPeriodEnd',false,'storageBytes',0));
$$;

revoke all on function public.paddle_billing_reserve_checkout(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.paddle_billing_bind_checkout(uuid,text,text) from public,anon,authenticated;
revoke all on function public.paddle_billing_apply_event(text,text,text,timestamptz,text,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.paddle_billing_status(uuid,text) from public,anon,authenticated;
grant execute on function public.paddle_billing_reserve_checkout(uuid,text,uuid,text) to service_role;
grant execute on function public.paddle_billing_bind_checkout(uuid,text,text) to service_role;
grant execute on function public.paddle_billing_apply_event(text,text,text,timestamptz,text,jsonb,jsonb,text) to service_role;
grant execute on function public.paddle_billing_status(uuid,text) to service_role;
