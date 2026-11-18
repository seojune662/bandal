-- bandal.io/admin, second pass: what the first dashboard could not answer.
--   * AI usage and what it cost us (ai_usage_ledger, written by the iPad ai-proxy).
--   * Which apps and versions are in use, read from the user agent that Auth already keeps
--     on each session (auth.sessions.user_agent): nothing new is collected. The iPad sends
--     "Bandal/<build> CFNetwork/… Darwin/<x>", desktop builds before 0.98.1 send "node" and
--     later ones "Bandal-Desktop/<version> (<os> <arch>)", the website a browser string.
--   * Server state the database can see: cron runs, App Store notifications, AI replies,
--     unfinished deletions and Apple sign-in revocation coverage.
--   * One user, looked up by email or id, for support.
-- Units: AI amounts are µ¢ (1 µ¢ = $1e-8), as in ai_settings. IP addresses are never returned.
begin;

-- A lookup is audited too; it names the user shown (or none for a list of matches).
alter table public.admin_audit drop constraint if exists admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check check (action in ('overview', 'lookup'));
alter table public.admin_audit alter column range_from drop not null, alter column range_to drop not null;
alter table public.admin_audit add column if not exists target uuid;
alter table public.admin_audit add constraint admin_audit_shape check (
  (action = 'overview' and range_from is not null and range_to is not null and target is null)
  or (action = 'lookup' and range_from is null and range_to is null));

-- Platform, version and OS from a session's user agent.
create or replace function public.bandal_admin_client(ua text) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when ua ~ '^Bandal/[0-9]+ ' then jsonb_build_object('platform', 'ipad',
      'version', 'build ' || (regexp_match(ua, '^Bandal/([0-9]+)'))[1],
      'os', coalesce('Darwin ' || (regexp_match(ua, 'Darwin/([0-9.]+)'))[1], ''))
    when ua ~ '^Bandal-Desktop/' then jsonb_build_object('platform', 'desktop',
      'version', coalesce((regexp_match(ua, '^Bandal-Desktop/([0-9A-Za-z.+-]{1,32})'))[1], ''),
      'os', coalesce((regexp_match(ua, '\(([a-z0-9]{1,16}) ?([a-z0-9_]{0,16})\)'))[1], ''))
    when ua ~ '^node' then jsonb_build_object('platform', 'desktop', 'version', '0.98.0 이하', 'os', '')
    when ua ~ 'Mozilla/' then jsonb_build_object('platform', 'web',
      'version', case when ua ~ 'Edg/' then 'Edge' when ua ~ 'Chrome/' then 'Chrome' when ua ~ 'Firefox/' then 'Firefox' when ua ~ 'Safari/' then 'Safari' else 'Browser' end,
      'os', case when ua ~ 'iPad|iPhone' then 'iOS' when ua ~ 'Macintosh' then 'macOS' when ua ~ 'Windows' then 'Windows' when ua ~ 'Android' then 'Android' else '' end)
    else jsonb_build_object('platform', 'other', 'version', '', 'os', '')
  end
$$;

-- AI, clients and server state for [from_input, to_input). Days are Asia/Seoul calendar days.
create or replace function public.bandal_admin_insights(actor uuid, from_input timestamptz, to_input timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.bandal_admin_is_operator(actor) then raise exception 'admin_required' using errcode = '42501'; end if;
  if from_input is null or to_input is null or from_input >= to_input or to_input - from_input > interval '366 days' then
    raise exception 'admin_invalid_range' using errcode = '22023';
  end if;

  with
  ledger as (
    select * from public.ai_usage_ledger where ts >= from_input and ts < to_input
  ),
  days as (
    select d::date as day
    from generate_series((from_input at time zone 'Asia/Seoul')::date, ((to_input - interval '1 microsecond') at time zone 'Asia/Seoul')::date, interval '1 day') d
  ),
  ai_daily as (
    select (ts at time zone 'Asia/Seoul')::date as day, sum(cost_ucents)::bigint as cost, count(*) as n, count(distinct user_id) as users
    from ledger group by 1
  ),
  -- The latest state of each session seen in the range: one row per user and client.
  seen as (
    select s.user_id, public.bandal_admin_client(s.user_agent) as client,
      max(coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at)) as last_seen
    from auth.sessions s
    where coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) >= from_input
      and coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) < to_input
    group by 1, 2
  ),
  cron_last as (
    select distinct on (r.jobid) r.jobid, r.status, r.start_time, r.end_time, left(r.return_message, 200) as message
    from cron.job_run_details r order by r.jobid, r.start_time desc
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', from_input, 'to', to_input, 'timeZone', 'Asia/Seoul'),
    'generatedAt', now(),
    'ai', jsonb_build_object(
      'unit', 'ucents',
      'cost', coalesce((select sum(cost_ucents) from ledger), 0),
      'requests', (select count(*) from ledger),
      'users', (select count(distinct user_id) from ledger),
      'incomplete', (select count(*) filter (where not complete) from ledger),
      'tokensIn', coalesce((select sum(tokens_in + tokens_cache_r + tokens_cache_w) from ledger), 0),
      'tokensOut', coalesce((select sum(tokens_out) from ledger), 0),
      'byModel', coalesce((select jsonb_agg(jsonb_build_object('model', model, 'requests', n, 'cost', cost, 'tokensIn', tin, 'tokensOut', tout) order by cost desc) from (
        select model, count(*) as n, sum(cost_ucents) as cost, sum(tokens_in + tokens_cache_r + tokens_cache_w) as tin, sum(tokens_out) as tout from ledger group by model) m), '[]'::jsonb),
      'byKind', coalesce((select jsonb_object_agg(kind, jsonb_build_object('requests', n, 'cost', cost)) from (
        select kind, count(*) as n, sum(cost_ucents) as cost from ledger group by kind) k), '{}'::jsonb),
      'topUsers', coalesce((select jsonb_agg(jsonb_build_object('userId', t.user_id, 'nickname', p.nickname, 'requests', t.n, 'cost', t.cost) order by t.cost desc) from (
        select user_id, count(*) as n, sum(cost_ucents) as cost from ledger group by user_id order by sum(cost_ucents) desc limit 10) t
        left join public.profiles p on p.id = t.user_id), '[]'::jsonb),
      'credit', jsonb_build_object(
        'outstanding', (select coalesce(sum(balance_ucents), 0) from public.ai_credit),
        'granted', (select coalesce(sum(amount_ucents), 0) from public.ai_credit_grants where granted_at >= from_input and granted_at < to_input and revoked_at is null),
        'bySource', coalesce((select jsonb_object_agg(source, amount) from (
          select source, sum(amount_ucents) as amount from public.ai_credit_grants where granted_at >= from_input and granted_at < to_input and revoked_at is null group by source) g), '{}'::jsonb)
      ),
      'caps', (select jsonb_build_object('free', free_cap, 'plus', plus_cap, 'pro', pro_cap, 'trial', trial_cap, 'pack', pack_ucents) from public.ai_settings limit 1),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'cost', coalesce(a.cost, 0), 'requests', coalesce(a.n, 0), 'users', coalesce(a.users, 0)) order by d.day), '[]'::jsonb)
        from days d left join ai_daily a using (day))
    ),
    'clients', jsonb_build_object(
      'platforms', coalesce((select jsonb_object_agg(platform, n) from (
        select client->>'platform' as platform, count(distinct user_id) as n from seen group by 1) p), '{}'::jsonb),
      'versions', coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'version', version, 'os', os, 'users', n, 'lastSeen', last_seen) order by platform, last_seen desc) from (
        select client->>'platform' as platform, client->>'version' as version, client->>'os' as os, count(distinct user_id) as n, max(last_seen) as last_seen
        from seen group by 1, 2, 3) v), '[]'::jsonb)
    ),
    'health', jsonb_build_object(
      'cron', coalesce((select jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
          'lastStatus', l.status, 'lastStart', l.start_time, 'lastEnd', l.end_time, 'lastMessage', l.message,
          'failedDay', (select count(*) from cron.job_run_details r where r.jobid = j.jobid and r.status = 'failed' and r.start_time > now() - interval '1 day')) order by j.jobname)
        from cron.job j left join cron_last l on l.jobid = j.jobid), '[]'::jsonb),
      'store', jsonb_build_object(
        'lastProduction', (select max(received_at) from public.ipad_store_events where environment = 'production'),
        'lastSandbox', (select max(received_at) from public.ipad_store_events where environment = 'sandbox'),
        'productionWeek', (select count(*) from public.ipad_store_events where environment = 'production' and received_at > now() - interval '7 days')
      ),
      'ai', jsonb_build_object(
        'last', (select max(ts) from public.ai_usage_ledger),
        'day', (select count(*) from public.ai_usage_ledger where ts > now() - interval '1 day'),
        'incompleteDay', (select count(*) from public.ai_usage_ledger where ts > now() - interval '1 day' and not complete)
      ),
      'deletions', jsonb_build_object(
        'stuck', (select count(*) from public.bandal_account_deletions where completed_at is null and started_at < now() - interval '1 hour'),
        'week', (select count(*) from public.bandal_account_deletions where started_at > now() - interval '7 days')
      ),
      -- Apple requires the sign-in to be revoked when an account is deleted; that needs a stored authorization.
      'appleRevocation', jsonb_build_object(
        'appleUsers', (select count(distinct i.user_id) from auth.identities i join auth.users u on u.id = i.user_id where i.provider = 'apple' and u.deleted_at is null),
        'stored', (select count(*) from public.bandal_apple_authorizations where revoked_at is null)
      )
    )
  ) into result;
  return result;
end $$;

-- One user by id, or the users whose email contains the query (at most 10).
create or replace function public.bandal_admin_lookup(actor uuid, query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := lower(btrim(coalesce(query, '')));
  matches jsonb;
  target uuid;
  detail jsonb;
begin
  if not public.bandal_admin_is_operator(actor) then raise exception 'admin_required' using errcode = '42501'; end if;
  if length(q) < 2 or length(q) > 254 then raise exception 'admin_invalid_query' using errcode = '22023'; end if;

  if q ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at)), '[]'::jsonb)
      into matches from auth.users u where u.id = q::uuid;
  else
    select coalesce(jsonb_agg(m order by m->>'lastSignInAt' desc nulls last), '[]'::jsonb) into matches from (
      select jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at) as m
      from auth.users u
      where strpos(lower(coalesce(u.email, '')), q) > 0
         or exists (select 1 from auth.identities i where i.user_id = u.id and strpos(lower(coalesce(i.email, '')), q) > 0)
         or exists (select 1 from public.profiles p where p.id = u.id and strpos(lower(coalesce(p.nickname, '')), q) > 0)
      order by u.last_sign_in_at desc nulls last
      limit 10) found;
  end if;

  if jsonb_array_length(matches) = 1 then
    target := (matches->0->>'id')::uuid;
    select jsonb_build_object(
      'id', u.id, 'email', u.email, 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at, 'deletedAt', u.deleted_at,
      'nickname', (select p.nickname from public.profiles p where p.id = u.id),
      'providers', coalesce((select jsonb_agg(jsonb_build_object('provider', i.provider, 'createdAt', i.created_at, 'lastSignInAt', i.last_sign_in_at) order by i.created_at)
        from auth.identities i where i.user_id = u.id), '[]'::jsonb),
      'apple', coalesce((select jsonb_agg(jsonb_build_object('environment', e.environment, 'plan', e.plan, 'trial', e.is_trial, 'expiresAt', e.expires_at, 'revokedAt', e.revoked_at, 'updatedAt', e.updated_at) order by e.updated_at desc)
        from public.ipad_entitlements e where e.user_id = u.id), '[]'::jsonb),
      'paddle', coalesce((select jsonb_agg(jsonb_build_object('environment', s.environment, 'status', s.status, 'plan', c.plan, 'periodEndsAt', s.period_ends_at, 'scheduledAction', s.scheduled_action) order by s.created_at desc)
        from public.paddle_billing_subscriptions s left join public.paddle_billing_catalog c on c.environment = s.environment and c.price_id = s.price_id where s.user_id = u.id), '[]'::jsonb),
      'ai', jsonb_build_object(
        'credit', (select balance_ucents from public.ai_credit where user_id = u.id),
        'budgets', coalesce((select jsonb_agg(jsonb_build_object('period', b.period, 'spent', b.spent_ucents) order by b.period desc) from (
          select * from public.ai_budget where user_id = u.id order by period desc limit 3) b), '[]'::jsonb),
        'month', (select jsonb_build_object('cost', coalesce(sum(cost_ucents), 0), 'requests', count(*)) from public.ai_usage_ledger where user_id = u.id and ts > now() - interval '30 days'),
        'grants', coalesce((select jsonb_agg(jsonb_build_object('source', g.source, 'amount', g.amount_ucents, 'grantedAt', g.granted_at, 'revokedAt', g.revoked_at) order by g.granted_at desc) from (
          select * from public.ai_credit_grants where user_id = u.id order by granted_at desc limit 10) g), '[]'::jsonb),
        'recent', coalesce((select jsonb_agg(jsonb_build_object('ts', l.ts, 'model', l.model, 'kind', l.kind, 'effort', l.effort, 'cost', l.cost_ucents,
            'tokensIn', l.tokens_in + l.tokens_cache_r + l.tokens_cache_w, 'tokensOut', l.tokens_out, 'complete', l.complete) order by l.ts desc) from (
          select * from public.ai_usage_ledger where user_id = u.id order by ts desc limit 20) l), '[]'::jsonb)
      ),
      'clients', coalesce((select jsonb_agg(c order by c->>'lastSeen' desc) from (
        select public.bandal_admin_client(s.user_agent) || jsonb_build_object('lastSeen', max(coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at)), 'sessions', count(*)) as c
        from auth.sessions s where s.user_id = u.id group by s.user_agent) cs), '[]'::jsonb),
      'deletion', (select jsonb_build_object('startedAt', d.started_at, 'completedAt', d.completed_at) from public.bandal_account_deletions d where d.user_id = u.id),
      'appleAuthorization', exists (select 1 from public.bandal_apple_authorizations a where a.user_id = u.id and a.revoked_at is null),
      'referral', jsonb_build_object(
        'code', (select r.code from public.referral_code r where r.owner_id = u.id limit 1),
        'invited', (select count(*) from public.referral_claim r where r.referrer_id = u.id),
        'invitedBy', exists (select 1 from public.referral_claim r where r.referee_id = u.id))
    ) into detail
    from auth.users u where u.id = target;
  end if;

  return jsonb_build_object('matches', matches, 'user', detail, 'target', target);
end $$;

revoke all on function public.bandal_admin_client(text) from public, anon, authenticated;
revoke all on function public.bandal_admin_insights(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.bandal_admin_lookup(uuid, text) from public, anon, authenticated;
grant execute on function public.bandal_admin_client(text) to service_role;
grant execute on function public.bandal_admin_insights(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.bandal_admin_lookup(uuid, text) to service_role;

commit;
