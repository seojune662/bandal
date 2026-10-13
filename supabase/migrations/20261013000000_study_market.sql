-- Study materials marketplace. Separate from the plugin marketplace.
-- All writes and financial state transitions are server-only. No client may
-- select a storage path, mutate a price snapshot, or mark an order paid.
create table public.study_market_schools (
  id text primary key, name text not null, enabled boolean not null default true
);
create table public.study_market_members (
  user_id uuid primary key references auth.users(id),
  school_id text not null references public.study_market_schools(id),
  updated_at timestamptz not null default now()
);
create table public.study_market_operators (
  user_id uuid primary key references auth.users(id)
);
create table public.study_market_courses (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.study_market_schools(id),
  name text not null check(length(name) between 1 and 100),
  normalized_name text not null, professor text not null default '',
  course_code text not null default '', created_at timestamptz not null default now(),
  unique(school_id, normalized_name, professor, course_code)
);
create table public.study_market_sellers (
  user_id uuid primary key references auth.users(id), ref_id text not null unique,
  provider_id text unique, status text not null default 'unregistered',
  display_name text not null check(length(display_name) between 1 and 80),
  held boolean not null default false, environment text not null check(environment in ('test','live')),
  updated_at timestamptz not null default now()
);
create table public.study_market_listings (
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.study_market_sellers(user_id),
  school_id text not null references public.study_market_schools(id), course_id uuid not null references public.study_market_courses(id),
  title text not null check(length(title) between 1 and 100), description text not null check(length(description) between 1 and 4000),
  price integer not null check(price between 1 and 1000000000),
  professor text not null default '', semester text not null default '', material_type text not null default 'notes',
  status text not null default 'draft' check(status in ('draft','processing','published','paused','blocked')),
  current_version_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index study_market_listings_browse on public.study_market_listings(school_id, status, created_at desc);
create table public.study_market_versions (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.study_market_listings(id),
  state text not null default 'uploading' check(state in ('uploading','sealing','ready','rejected')),
  rights_attested_at timestamptz, manifest_sha256 text, cleaned_at timestamptz, staging_cleaned_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.study_market_listings add foreign key(current_version_id) references public.study_market_versions(id);
create table public.study_market_files (
  id uuid not null default gen_random_uuid(), version_id uuid not null references public.study_market_versions(id),
  name text not null check(length(name) between 1 and 240), rel_path text not null,
  mime text not null, bytes bigint not null check(bytes between 0 and 52428800),
  expected_sha256 text not null check(expected_sha256 ~ '^[a-f0-9]{64}$'),
  sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
  staging_path text not null unique, final_path text not null unique,
  state text not null default 'pending' check(state in ('pending','copied','verified','rejected')),
  preview boolean not null default false, primary key(version_id,id), unique(version_id, rel_path)
);
create table public.study_market_orders (
  id uuid primary key default gen_random_uuid(), buyer_id uuid not null references auth.users(id),
  seller_id uuid not null references public.study_market_sellers(user_id), listing_id uuid not null references public.study_market_listings(id),
  version_id uuid not null references public.study_market_versions(id), title text not null,
  amount integer not null check(amount > 0), fee integer not null check(fee >= 0), seller_amount integer not null check(seller_amount > 0),
  currency text not null default 'KRW' check(currency = 'KRW'), environment text not null check(environment in ('test','live')),
  status text not null default 'pending' check(status in ('pending','paid','refund_pending','refund_due','refunded','expired','review')),
  payment_key text unique, idempotency_key uuid not null, checkout_token_hash text not null,
  checkout_expires_at timestamptz not null default now() + interval '30 minutes',
  consent_at timestamptz not null, paid_at timestamptz, downloaded_at timestamptz, receipt_url text,
  refund_reason text, refund_key uuid, refunded_at timestamptz, last_reconciled_at timestamptz,
  created_at timestamptz not null default now(), unique(buyer_id,idempotency_key),
  check(amount = fee + seller_amount)
);
create index study_market_reconcile on public.study_market_orders(last_reconciled_at nulls first) where status in ('pending','paid','refund_pending','refund_due','review');
create unique index study_market_one_purchase on public.study_market_orders(buyer_id,listing_id)
  where status in ('pending','paid','refund_pending','review');
create table public.study_market_payouts (
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.study_market_sellers(user_id),
  amount bigint not null check(amount > 0 and amount < 1000000000), environment text not null check(environment in ('test','live')),
  provider_id text unique, status text not null default 'reserved' check(status in ('reserved','requested','completed','failed','review')),
  run_date date not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_reconciled_at timestamptz,
  unique(seller_id,run_date,environment)
);
create index study_market_payout_reconcile on public.study_market_payouts(last_reconciled_at nulls first) where status in ('requested','reserved');
create table public.study_market_ledger (
  id bigint generated always as identity primary key, seller_id uuid not null references public.study_market_sellers(user_id),
  order_id uuid not null references public.study_market_orders(id), kind text not null check(kind in ('sale','refund')),
  amount integer not null, available_at timestamptz not null, payout_id uuid references public.study_market_payouts(id),
  created_at timestamptz not null default now(), unique(order_id,kind)
);
create table public.study_market_reports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  listing_id uuid not null references public.study_market_listings(id), reason text not null check(length(reason) between 1 and 2000),
  status text not null default 'open' check(status in ('open','resolved')), created_at timestamptz not null default now(),
  unique(user_id,listing_id)
);
create table public.study_market_cases (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  kind text not null check(kind in ('refund','school','receivable')), subject_id text not null,
  reason text not null check(length(reason) between 1 and 2000), status text not null default 'open',
  created_at timestamptz not null default now()
);
create unique index study_market_cases_open on public.study_market_cases(user_id,kind,subject_id) where status='open';
create table public.study_market_audit (
  id bigint generated always as identity primary key, actor uuid references auth.users(id), action text not null,
  entity_id text not null, reason text not null default '', created_at timestamptz not null default now()
);
create table public.study_market_webhooks (
  id text primary key, event_type text not null, processed_at timestamptz not null default now()
);
-- Populate with reviewed Korean banking calendar before enabling live payouts.
-- Missing dates fail closed; weekends alone are not a holiday calendar.
create table public.study_market_calendar_years (
  year integer primary key check(year between 2026 and 2200), source text not null, verified_at timestamptz not null default now()
);
create table public.study_market_business_days (
  date date primary key, is_business_day boolean not null, source text not null, verified_at timestamptz not null default now()
);
create table public.study_market_jobs (name text primary key, cursor text not null default '');
insert into public.study_market_jobs(name) values('payout_scan');
create table public.study_market_readiness (
  id boolean primary key default true check(id), live_enabled boolean not null default false,
  contracts_verified boolean not null default false, policies_verified boolean not null default false,
  webhook_verified boolean not null default false, payout_verified boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.study_market_readiness(id) values(true);

do $$ declare t text; begin
  foreach t in array array['schools','members','operators','courses','sellers','listings','versions','files','orders','payouts','ledger','reports','cases','audit','webhooks','business_days','calendar_years','readiness','jobs'] loop
    execute format('alter table public.study_market_%I enable row level security',t);
    execute format('revoke all on public.study_market_%I from public, anon, authenticated',t);
    execute format('grant all on public.study_market_%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence public.study_market_ledger_id_seq,public.study_market_audit_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('study-market-staging','study-market-staging',false,52428800,array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
       ('study-market-files','study-market-files',false,52428800,array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;
-- No client Storage policies. Signed grants only target reserved staging paths;
-- a stale grant can never overwrite a server-owned final object.

create function public.study_market_create_order(actor uuid, listing uuid, request_key uuid, token_hash text, env text)
returns public.study_market_orders language plpgsql security definer set search_path='' as $$
declare l public.study_market_listings; s public.study_market_sellers; o public.study_market_orders; begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text || listing::text,0));
  select * into o from public.study_market_orders where buyer_id=actor and idempotency_key=request_key;
  if found then return o; end if;
  select * into strict l from public.study_market_listings where id=listing for share;
  select * into strict s from public.study_market_sellers where user_id=l.seller_id for share;
  if l.status <> 'published' or l.current_version_id is null or s.held or s.status not in ('APPROVED','PARTIALLY_APPROVED') or s.environment <> env or l.seller_id=actor then raise exception 'not_purchasable'; end if;
  if not exists(select 1 from public.study_market_members where user_id=actor and school_id=l.school_id) then raise exception 'school_mismatch'; end if;
  if env='live' and not exists(select 1 from public.study_market_readiness where live_enabled and contracts_verified and policies_verified and webhook_verified and payout_verified) then raise exception 'live_not_ready'; end if;
  update public.study_market_orders set status='expired' where buyer_id=actor and listing_id=listing and status='pending' and checkout_expires_at<now();
  if exists(select 1 from public.study_market_orders where buyer_id=actor and listing_id=listing and status in ('pending','paid','refund_pending','review')) then raise exception 'purchase_exists'; end if;
  insert into public.study_market_orders(buyer_id,seller_id,listing_id,version_id,title,amount,fee,seller_amount,environment,idempotency_key,checkout_token_hash,consent_at)
  values(actor,l.seller_id,l.id,l.current_version_id,l.title,l.price,l.price/10,l.price-l.price/10,env,request_key,token_hash,now()) returning * into o;
  return o;
end $$;

create function public.study_market_apply_payment(order_input uuid, payment_input text, amount_input integer, currency_input text, status_input text, approved_input timestamptz, env text)
returns public.study_market_orders language plpgsql security definer set search_path='' as $$
declare o public.study_market_orders; begin
  select seller_id into o.seller_id from public.study_market_orders where id=order_input;
  perform pg_advisory_xact_lock(hashtextextended(o.seller_id::text,1));
  select * into strict o from public.study_market_orders where id=order_input for update;
  if o.amount<>amount_input or currency_input<>'KRW' or o.environment<>env or (o.payment_key is not null and o.payment_key<>payment_input) then raise exception 'payment_mismatch'; end if;
  if status_input='DONE' then
    if o.status in ('paid','refund_pending','refund_due','refunded','review') then return o; end if;
    if o.status<>'pending' then
      update public.study_market_orders set status='refund_due',payment_key=payment_input,paid_at=approved_input,refund_key=gen_random_uuid(),refund_reason='만료된 주문의 지연 결제 자동 취소' where id=o.id returning * into o;
      return o;
    end if;
    update public.study_market_orders set status='paid',payment_key=payment_input,paid_at=approved_input where id=o.id returning * into o;
    insert into public.study_market_ledger(seller_id,order_id,kind,amount,available_at)
      values(o.seller_id,o.id,'sale',o.seller_amount,approved_input+interval '7 days') on conflict do nothing;
  elsif status_input='CANCELED' then
    if o.status='refunded' then return o; end if;
    update public.study_market_orders set status='refunded',payment_key=payment_input,refunded_at=now() where id=o.id returning * into o;
    if exists(select 1 from public.study_market_ledger where order_id=o.id and kind='sale') then
      insert into public.study_market_ledger(seller_id,order_id,kind,amount,available_at)
      values(o.seller_id,o.id,'refund',-o.seller_amount,now()) on conflict do nothing;
    end if;
    if exists(select 1 from public.study_market_ledger e join public.study_market_payouts p on p.id=e.payout_id where e.order_id=o.id and p.status in ('reserved','requested','completed','review')) then
      update public.study_market_sellers set held=true where user_id=o.seller_id;
      insert into public.study_market_cases(user_id,kind,subject_id,reason)
      values(o.seller_id,'receivable',o.id::text,'정산 배정 후 환불: 판매자 잔액과 지급 결과 확인 필요')
      on conflict(user_id,kind,subject_id) where status='open' do nothing;
    end if;
  elsif status_input='PARTIAL_CANCELED' then
    update public.study_market_orders set status='review' where id=o.id returning * into o;
    update public.study_market_sellers set held=true where user_id=o.seller_id;
    insert into public.study_market_cases(user_id,kind,subject_id,reason) values(o.buyer_id,'refund',o.id::text,'PG 부분 취소: 결제 잔액과 전액 환불 처리 검토 필요') on conflict(user_id,kind,subject_id) where status='open' do nothing;
  end if;
  return o;
end $$;

create function public.study_market_begin_refund(actor uuid, order_input uuid, reason_input text)
returns public.study_market_orders language plpgsql security definer set search_path='' as $$
declare o public.study_market_orders; op boolean; begin
  select seller_id into o.seller_id from public.study_market_orders where id=order_input;
  perform pg_advisory_xact_lock(hashtextextended(o.seller_id::text,1));
  select * into strict o from public.study_market_orders where id=order_input for update;
  op := exists(select 1 from public.study_market_operators where user_id=actor);
  if not op and o.buyer_id<>actor then raise exception 'not_authorized'; end if;
  if o.status in ('refunded','refund_pending','refund_due') then return o; end if;
  if not op and (o.downloaded_at is not null or o.paid_at < now()-interval '7 days') then raise exception 'operator_review_required'; end if;
  if o.status not in ('paid','review') or length(trim(reason_input)) not between 1 and 2000 then raise exception 'invalid_refund'; end if;
  if exists(select 1 from public.study_market_ledger e join public.study_market_payouts p on p.id=e.payout_id where e.order_id=o.id and p.status in ('reserved','requested','review')) then raise exception 'payout_in_progress'; end if;
  update public.study_market_orders set status='refund_pending',refund_reason=reason_input,refund_key=gen_random_uuid() where id=o.id returning * into o;
  insert into public.study_market_audit(actor,action,entity_id,reason) values(actor,'refund_requested',o.id::text,reason_input);
  return o;
end $$;

create function public.study_market_download(actor uuid, order_input uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare o public.study_market_orders; begin
  select * into strict o from public.study_market_orders where id=order_input and buyer_id=actor for update;
  if o.status<>'paid' then raise exception 'purchase_required'; end if;
  if exists(select 1 from public.study_market_listings where id=o.listing_id and status='blocked') then raise exception 'listing_blocked'; end if;
  update public.study_market_orders set downloaded_at=coalesce(downloaded_at,now()) where id=o.id;
  return o.version_id;
end $$;

create function public.study_market_reserve_payout(seller_input uuid, date_input date, env text)
returns public.study_market_payouts language plpgsql security definer set search_path='' as $$
declare p public.study_market_payouts; total bigint; entries bigint[]; begin
  perform pg_advisory_xact_lock(hashtextextended(seller_input::text,1));
  select * into p from public.study_market_payouts where seller_id=seller_input and run_date=date_input and environment=env;
  if found then return p; end if;
  if not exists(select 1 from public.study_market_sellers where user_id=seller_input and status in ('APPROVED','PARTIALLY_APPROVED') and not held and environment=env) then raise exception 'seller_not_ready'; end if;
  if exists(select 1 from public.study_market_payouts where seller_id=seller_input and status in ('reserved','requested','review')) then raise exception 'payout_in_progress'; end if;
  if not exists(select 1 from public.study_market_calendar_years where year=extract(year from date_input)) or not exists(select 1 from public.study_market_business_days where date=date_input and is_business_day) then raise exception 'calendar_unverified'; end if;
  -- Lock all candidate entries before computing the sum; refund and claim use the same seller lock.
  perform 1 from public.study_market_ledger where seller_id=seller_input and payout_id is null for update;
  with eligible as materialized (
    select e.id,e.order_id,e.amount from public.study_market_ledger e join public.study_market_orders o on o.id=e.order_id
    where e.seller_id=seller_input and e.payout_id is null and e.available_at<now() and o.environment=env and o.status in ('paid','refunded')
      and not exists(select 1 from public.study_market_listings l where l.id=o.listing_id and l.status='blocked')
      and not exists(select 1 from public.study_market_reports r where r.listing_id=o.listing_id and r.status='open')
  ), per_order as (
    select order_id,sum(amount) amount,min(id) first_id from eligible group by order_id
  ), running as (
    select order_id,sum(amount) over(order by (amount<=0) desc,first_id rows unbounded preceding) running_amount from per_order
  )
  select array_agg(e.id),coalesce(sum(e.amount),0) into entries,total from eligible e join running r on r.order_id=e.order_id
    where r.running_amount<1000000000;
  if total<=0 then return null; end if;
  insert into public.study_market_payouts(seller_id,amount,run_date,environment) values(seller_input,total,date_input,env) returning * into p;
  -- Assign the exact snapshot used for the amount, even if a report/block
  -- changes eligibility between statements. Submission rechecks the whole set.
  update public.study_market_ledger set payout_id=p.id where id=any(entries);
  return p;
end $$;

create function public.study_market_publish(actor uuid, version_input uuid, manifest_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.study_market_versions; l public.study_market_listings; begin
  select * into strict v from public.study_market_versions where id=version_input for update;
  select * into strict l from public.study_market_listings where id=v.listing_id and seller_id=actor for update;
  if v.rights_attested_at is null or v.state not in ('sealing','ready') or l.status='blocked' or l.current_version_id<>v.id or manifest_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_publish'; end if;
  if not exists(select 1 from public.study_market_files where version_id=v.id and not preview)
     or not exists(select 1 from public.study_market_files where version_id=v.id and preview)
     or exists(select 1 from public.study_market_files where version_id=v.id and state<>'verified')
     or (select count(*) from public.study_market_files where version_id=v.id and not preview)>100
     or (select count(*) from public.study_market_files where version_id=v.id and preview)>3
     or (select sum(bytes) from public.study_market_files where version_id=v.id)>209715200 then raise exception 'files_not_verified'; end if;
  if not exists(select 1 from public.study_market_sellers where user_id=actor and status in ('APPROVED','PARTIALLY_APPROVED') and not held) then raise exception 'seller_not_ready'; end if;
  if v.state='ready' and v.manifest_sha256<>manifest_hash then raise exception 'immutable_version'; end if;
  update public.study_market_versions set state='ready',manifest_sha256=manifest_hash where id=v.id;
  update public.study_market_listings set current_version_id=v.id,status='published',updated_at=now() where id=l.id;
  return l.id;
end $$;

-- The application cannot alter a committed file manifest even through a stale
-- server handler. New revisions always use new rows and new object keys.
create function public.study_market_immutable_file() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.study_market_versions where state='ready' and (id=case when tg_op='INSERT' then new.version_id else old.version_id end or id=case when tg_op='DELETE' then old.version_id else new.version_id end)) then raise exception 'immutable_version'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger study_market_files_immutable before insert or update or delete on public.study_market_files for each row execute function public.study_market_immutable_file();

create function public.study_market_apply_payout(payout_input uuid, provider_input text, status_input text)
returns void language plpgsql security definer set search_path='' as $$
declare p public.study_market_payouts; begin
  select seller_id into p.seller_id from public.study_market_payouts where id=payout_input;
  perform pg_advisory_xact_lock(hashtextextended(p.seller_id::text,1));
  select * into strict p from public.study_market_payouts where id=payout_input for update;
  if (p.provider_id is not null and p.provider_id<>provider_input) or status_input not in ('requested','completed','failed','review') then raise exception 'payout_mismatch'; end if;
  if p.status='completed' then return; end if;
  if p.status='failed' and status_input<>'failed' then raise exception 'payout_state_mismatch'; end if;
  update public.study_market_payouts set provider_id=provider_input,status=status_input,updated_at=now() where id=p.id;
  if status_input='failed' then update public.study_market_ledger set payout_id=null where payout_id=p.id; end if;
end $$;

create table public.study_market_rate (
  actor text not null, bucket bigint not null, hits integer not null, created_at timestamptz not null default now(), primary key(actor,bucket)
);
alter table public.study_market_rate enable row level security;
revoke all on public.study_market_rate from public,anon,authenticated;
grant all on public.study_market_rate to service_role;
create function public.study_market_check_rate(actor_input text, max_input integer, period_input integer default 60)
returns void language plpgsql security definer set search_path='' as $$
declare n integer; begin
  if period_input not in (60,3600) or max_input<1 or max_input>1000 then raise exception 'invalid_rate_limit'; end if;
  insert into public.study_market_rate(actor,bucket,hits) values(actor_input,floor(extract(epoch from now())/period_input)::bigint,1)
  on conflict(actor,bucket) do update set hits=study_market_rate.hits+1 returning hits into n;
  if n>max_input then raise exception 'rate_limited'; end if;
end $$;

-- Serialize pending-byte quota and manifest creation for concurrent uploads.
create function public.study_market_create_version(actor uuid, listing_input uuid, files_input jsonb, attested boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.study_market_listings; v uuid; pending_bytes bigint; pending_count integer; begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text,2));
  select * into strict l from public.study_market_listings where id=listing_input and seller_id=actor for update;
  if l.status='blocked' then raise exception 'listing_blocked'; end if;
  select coalesce(sum(f.bytes),0),count(distinct x.id) into pending_bytes,pending_count
    from public.study_market_versions x join public.study_market_listings a on a.id=x.listing_id
    left join public.study_market_files f on f.version_id=x.id
    where a.seller_id=actor and x.state<>'ready' and x.cleaned_at is null;
  if pending_count>=30 or pending_bytes+(select coalesce(sum((f->>'bytes')::bigint),0) from jsonb_array_elements(files_input) f)>1073741824 then raise exception 'upload_quota_exceeded'; end if;
  perform public.study_market_check_rate('draft:'||actor::text,15,3600);
  insert into public.study_market_versions(listing_id,rights_attested_at) values(l.id,case when attested then now() else null end) returning id into v;
  insert into public.study_market_files(id,version_id,name,rel_path,mime,bytes,expected_sha256,preview,staging_path,final_path)
    select (f->>'id')::uuid,v,reverse(split_part(reverse(f->>'path'),'/',1)),f->>'path',f->>'mime',(f->>'bytes')::bigint,f->>'sha256',coalesce((f->>'preview')::boolean,false),actor::text||'/'||v::text||'/'||(f->>'id'),v::text||'/'||(f->>'id') from jsonb_array_elements(files_input) f;
  update public.study_market_listings set current_version_id=v,status='draft' where id=l.id;
  return v;
end $$;

create function public.study_market_request_refund_review(actor uuid, order_input uuid, reason_input text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.study_market_orders; begin
  select seller_id into o.seller_id from public.study_market_orders where id=order_input;
  perform pg_advisory_xact_lock(hashtextextended(o.seller_id::text,1));
  select * into strict o from public.study_market_orders where id=order_input and buyer_id=actor for update;
  if o.status not in ('paid','review') then raise exception 'invalid_refund'; end if;
  update public.study_market_orders set status='review',refund_reason=reason_input where id=o.id;
  insert into public.study_market_cases(user_id,kind,subject_id,reason) values(actor,'refund',o.id::text,reason_input) on conflict(user_id,kind,subject_id) where status='open' do nothing;
  insert into public.study_market_audit(actor,action,entity_id,reason) values(actor,'refund_review_requested',o.id::text,reason_input);
end $$;

create function public.study_market_reject_refund(actor uuid, order_input uuid, reason_input text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.study_market_orders; begin
  if not exists(select 1 from public.study_market_operators where user_id=actor) then raise exception 'not_authorized'; end if;
  select * into strict o from public.study_market_orders where id=order_input for update;
  if o.status<>'review' or not exists(select 1 from public.study_market_cases where kind='refund' and subject_id=o.id::text and status='open') then raise exception 'invalid_refund'; end if;
  update public.study_market_orders set status='paid',refund_reason=reason_input where id=o.id;
  update public.study_market_cases set status='rejected' where kind='refund' and subject_id=o.id::text and status='open';
  insert into public.study_market_audit(actor,action,entity_id,reason) values(actor,'refund_rejected',o.id::text,reason_input);
end $$;

do $$ declare r record; begin
  for r in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'study_market_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;

insert into public.study_market_schools(id,name) values
('yonsei','연세대학교'),
('korea','고려대학교'),
('skku','성균관대학교'),
('hanyang','한양대학교'),
('cau','중앙대학교'),
('khu','경희대학교'),
('sogang','서강대학교'),
('ewha','이화여자대학교'),
('kaist','한국과학기술원'),
('postech','포항공과대학교'),
('konkuk','건국대학교'),
('dongguk','동국대학교'),
('pusan','부산대학교'),
('knu','경북대학교'),
('inha','인하대학교'),
('ajou','아주대학교'),
('sejong','세종대학교'),
('snu','서울대학교') on conflict(id) do nothing;
