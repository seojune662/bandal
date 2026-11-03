-- bandal.io/admin: an operator dashboard over data Supabase already holds.
--
-- * Approved operators are rows in admin_operators. Add or remove one with SQL
--   (service role) only; no API writes this table.
-- * The browser never reads a table. The `admin` Edge Function verifies the
--   Supabase session and calls bandal_admin_overview(actor, …) with the
--   service role. The function checks the operator itself again, so a mistaken
--   grant or a bug in the function's caller still cannot open it.
-- * Each successful read is recorded in admin_audit.
-- * Aggregates only: counts and sums. The one exception is recent feedback
--   text, which operators already triage. No email, no user id, no payment key
--   leaves the database.

create table public.admin_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default clock_timestamp()
);

create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('overview')),
  range_from timestamptz not null,
  range_to timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index admin_audit_actor_created on public.admin_audit (actor, created_at desc);

do $$ declare t text; begin
  foreach t in array array['admin_operators','admin_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage on sequence public.admin_audit_id_seq to service_role;

-- Whether `actor` is an approved operator. Service role only.
create function public.bandal_admin_is_operator(actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select actor is not null and exists (select 1 from public.admin_operators where user_id = actor)
$$;

-- Dashboard aggregates for [from_input, to_input). Days are Asia/Seoul calendar days.
create function public.bandal_admin_overview(actor uuid, from_input timestamptz, to_input timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.bandal_admin_is_operator(actor) then raise exception 'admin_required' using errcode = '42501'; end if;
  if from_input is null or to_input is null or from_input >= to_input or to_input - from_input > interval '366 days' then
    raise exception 'admin_invalid_range' using errcode = '22023';
  end if;

  with
  days as (
    select d::date as day
    from generate_series((from_input at time zone 'Asia/Seoul')::date, ((to_input - interval '1 microsecond') at time zone 'Asia/Seoul')::date, interval '1 day') d
  ),
  signups as (
    select (created_at at time zone 'Asia/Seoul')::date as day, count(*) as n
    from auth.users where created_at >= from_input and created_at < to_input group by 1
  ),
  payments as (
    select (created_at at time zone 'Asia/Seoul')::date as day, sum(amount)::bigint as amount, count(*) as n
    from public.paddle_billing_payments where environment = 'live' and created_at >= from_input and created_at < to_input group by 1
  ),
  market as (
    select (paid_at at time zone 'Asia/Seoul')::date as day, sum(amount)::bigint as amount, count(*) as n
    from public.study_market_orders where environment = 'live' and paid_at >= from_input and paid_at < to_input
      and status in ('paid','refund_pending','refund_due','refunded','review') group by 1
  ),
  paddle_active as (
    select c.plan, count(*) as n,
      count(*) filter (where s.scheduled_action = 'cancel') as canceling,
      count(*) filter (where s.status = 'past_due') as past_due
    from public.paddle_billing_subscriptions s
    join public.paddle_billing_catalog c on c.environment = s.environment and c.price_id = s.price_id
    where s.environment = 'live' and s.status in ('active','trialing','past_due')
    group by c.plan
  ),
  apple_active as (
    select s.plan, count(*) as n, count(*) filter (where not s.auto_renew) as canceling
    from public.apple_billing_subscriptions s
    where s.environment = 'production' and s.revoked_at is null
      and ((s.status = 1 and s.expires_at > now()) or (s.status = 4 and s.grace_expires_at > now()))
    group by s.plan
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', from_input, 'to', to_input, 'timeZone', 'Asia/Seoul'),
    'generatedAt', now(),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users where deleted_at is null),
      'new', (select count(*) from auth.users where created_at >= from_input and created_at < to_input),
      'signedIn', (select count(*) from auth.users where last_sign_in_at >= from_input and last_sign_in_at < to_input),
      'withProfile', (select count(*) from public.profiles where deleted_at is null),
      'deletionsStarted', (select count(*) from public.bandal_account_deletions where started_at >= from_input and started_at < to_input),
      'providers', coalesce((select jsonb_object_agg(provider, n) from (
        select provider, count(distinct user_id) as n from auth.identities group by provider) p), '{}'::jsonb)
    ),
    'subscriptions', jsonb_build_object(
      'paddle', jsonb_build_object(
        'active', coalesce((select sum(n) from paddle_active), 0),
        'byPlan', coalesce((select jsonb_object_agg(plan, n) from paddle_active), '{}'::jsonb),
        'canceling', coalesce((select sum(canceling) from paddle_active), 0),
        'pastDue', coalesce((select sum(past_due) from paddle_active), 0),
        'started', (select count(*) from public.paddle_billing_subscriptions where environment = 'live' and created_at >= from_input and created_at < to_input)
      ),
      'apple', jsonb_build_object(
        'active', coalesce((select sum(n) from apple_active), 0),
        'byPlan', coalesce((select jsonb_object_agg(plan, n) from apple_active), '{}'::jsonb),
        'canceling', coalesce((select sum(canceling) from apple_active), 0),
        'started', (select count(*) from public.apple_billing_transactions where environment = 'production'
          and transaction_id = original_transaction_id and purchased_at >= from_input and purchased_at < to_input)
      )
    ),
    'revenue', jsonb_build_object(
      'currency', 'KRW',
      'paddle', jsonb_build_object('amount', coalesce((select sum(amount) from payments), 0), 'payments', coalesce((select sum(n) from payments), 0)),
      'appleTransactions', (select count(*) from public.apple_billing_transactions where environment = 'production' and purchased_at >= from_input and purchased_at < to_input),
      'studyMarket', jsonb_build_object(
        'gross', coalesce((select sum(amount) from market), 0),
        'orders', coalesce((select sum(n) from market), 0),
        'fee', (select coalesce(sum(fee), 0) from public.study_market_orders where environment = 'live' and paid_at >= from_input and paid_at < to_input
          and status in ('paid','refund_pending','refund_due','refunded','review')),
        'refunded', (select count(*) from public.study_market_orders where environment = 'live' and refunded_at >= from_input and refunded_at < to_input)
      )
    ),
    'studyMarket', jsonb_build_object(
      'listings', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.study_market_listings group by status) l), '{}'::jsonb)
    ),
    'community', jsonb_build_object(
      'posts', (select count(*) from public.community_posts where created_at >= from_input and created_at < to_input),
      'comments', (select count(*) from public.community_comments where created_at >= from_input and created_at < to_input),
      'openReports', (select count(*) from public.community_reports where not resolved),
      'safetyReports', (select count(*) from public.reports where created_at >= from_input and created_at < to_input)
    ),
    'groups', jsonb_build_object(
      'active', (select count(*) from public.study_groups where deleted_at is null),
      'messages', (select count(*) from public.messages where created_at >= from_input and created_at < to_input)
    ),
    'feedback', jsonb_build_object(
      'count', (select count(*) from public.feedback where created_at >= from_input and created_at < to_input),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('createdAt', created_at, 'kind', kind, 'body', left(body, 280), 'appVersion', app_version, 'os', os) order by created_at desc)
        from (select * from public.feedback where created_at >= from_input and created_at < to_input order by created_at desc limit 10) f), '[]'::jsonb)
    ),
    'legacySync', jsonb_build_object(
      'users', (select count(*) from public.bandal_sync_usage where record_bytes + asset_bytes > 0),
      'bytes', (select coalesce(sum(record_bytes + asset_bytes), 0) from public.bandal_sync_usage)
    ),
    'marketplace', jsonb_build_object('plugins', (select count(*) from public.marketplace_plugins)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day, 'signups', coalesce(s.n, 0), 'paddleAmount', coalesce(p.amount, 0), 'paddlePayments', coalesce(p.n, 0),
        'marketAmount', coalesce(m.amount, 0), 'marketOrders', coalesce(m.n, 0)) order by d.day), '[]'::jsonb)
      from days d left join signups s using (day) left join payments p using (day) left join market m using (day))
  ) into result;
  return result;
end $$;

revoke all on function public.bandal_admin_is_operator(uuid) from public, anon, authenticated;
revoke all on function public.bandal_admin_overview(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.bandal_admin_is_operator(uuid) to service_role;
grant execute on function public.bandal_admin_overview(uuid, timestamptz, timestamptz) to service_role;
