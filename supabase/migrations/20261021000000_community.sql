-- Official Bandal community. The only public surface is campaign metadata.
-- Existing account authentication is reused; all content goes through the RPC.
create table public.community_campaigns (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text not null check (char_length(summary) <= 1000),
  rules text not null check (char_length(btrim(rules)) between 1 and 12000),
  published boolean not null default false,
  starts_at timestamptz, ends_at timestamptz, results_at timestamptz,
  results_published boolean not null default false,
  closed boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and starts_at < ends_at)),
  check (results_at is null or (ends_at is not null and results_at >= ends_at)),
  check (not results_published or ends_at is not null),
  check (not published or (starts_at is not null and ends_at is not null and results_at is not null))
);
create table public.community_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('contest','study','feedback')),
  campaign_id text references public.community_campaigns(id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) <= 10000 and (category='contest' or char_length(btrim(body)) >= 1)),
  answers jsonb,
  pinned boolean not null default false, hidden boolean not null default false,
  award smallint check (award in (1,2)),
  development_status text check (development_status in ('reviewing','planned','developing','available','not-planned')),
  development_note text not null default '' check (char_length(development_note) <= 3000),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check ((category='contest' and campaign_id is not null and answers is not null) or (category<>'contest' and campaign_id is null and answers is null)),
  check (award is null or category='contest')
);
create unique index community_award_unique on public.community_posts(campaign_id,award) where award is not null;
create index community_posts_feed on public.community_posts(pinned desc,created_at desc,id desc);
create index community_posts_campaign on public.community_posts(campaign_id);
-- Every accepted submission revision is immutable. The last revision before the
-- deadline is the judging copy; moderation never replaces it.
create table public.community_submission_snapshots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  campaign_id text not null references public.community_campaigns(id),
  title text not null, body text not null, answers jsonb not null,
  captured_at timestamptz not null default clock_timestamp()
);
create index community_snapshots_post on public.community_submission_snapshots(post_id,captured_at desc,id desc);
create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  hidden boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index community_comments_post on public.community_comments(post_id,created_at,id);
create table public.community_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(), primary key(post_id,user_id)
);
create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  resolved boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create unique index community_post_report_unique on public.community_reports(reporter_id,post_id) where comment_id is null;
create unique index community_comment_report_unique on public.community_reports(reporter_id,comment_id) where comment_id is not null;
create table public.community_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 8 and 128),
  action text not null, payload jsonb not null, response jsonb not null,
  created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_id)
);
create table public.community_rate_limits (
  actor_id uuid not null references auth.users(id) on delete cascade,
  bucket timestamptz not null, attempts integer not null, primary key(actor_id,bucket)
);
create table public.community_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id) on delete set null,
  action text not null, post_id uuid references public.community_posts(id) on delete set null,
  detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp()
);

insert into public.community_campaigns(id,title,summary,rules) values (
  'study-tools-2026','반달에 있었으면 하는 공부 도구 공모전',
  '정말 쓰고 싶은 공부법을 반달의 다음 학습 도구로 제안해 주세요. 1등 10만 원, 2등 5만 원.',
  E'상금: 1등 100,000원(1명), 2등 50,000원(1명).\n참여 방법: 반달에서 공부할 때 필요한 학습 도구 또는 공부법을 공모 참여 게시판에 제안합니다. 대상 사용자, 해결할 문제, 사용 순서, 구체적인 예시를 작성해 주세요. 코딩이나 완성된 제품은 필요하지 않습니다.\n심사: 실제 도움 40점, 제안의 구체성 30점, 구현 가능성 20점, 독창성 10점. 공감 수는 참고 자료이며 수상을 결정하지 않습니다.\n접수 기간과 결과 발표일은 확정 후 공개합니다. 마감 시각 이후에는 제출 내용을 수정할 수 없습니다.\n다른 사람의 글을 무단으로 복제한 응모, 허위 참여 또는 공감을 조작한 응모는 심사에서 제외할 수 있습니다.\n제안의 권리는 제안자에게 있습니다. 반달은 응모작을 공모 심사와 커뮤니티 공개에 활용합니다. 실제 제품 반영은 별도 검토하며 수상이 개발을 보장하지 않습니다. 수상과 개발 진행 상태는 따로 안내합니다.\n수상자 연락 및 상금 지급에 필요한 정보는 선정 후 별도로 안내하며 게시글에 개인정보를 적지 마세요.'
);

create function public.community_campaign_phase(c public.community_campaigns) returns text
language sql volatile set search_path='' as $$
 select case when not c.published then 'draft' when c.closed then 'closed'
 when c.starts_at is null or clock_timestamp()<c.starts_at then 'upcoming'
 when clock_timestamp()<c.ends_at then 'open'
 when c.results_published then 'results' else 'judging' end
$$;
create function public.community_campaign_json(c public.community_campaigns) returns jsonb
language sql volatile set search_path='' as $$
 select jsonb_build_object('id',c.id,'title',c.title,'summary',c.summary,'published',c.published,
 'phase',public.community_campaign_phase(c),'resultsPublished',c.results_published,'closed',c.closed,'startsAt',c.starts_at,'endsAt',c.ends_at,'resultsAt',c.results_at,'rules',c.rules)
$$;
create function public.community_public_campaign() returns jsonb
language sql volatile security definer set search_path='' as $$
 select public.community_campaign_json(c) from public.community_campaigns c
 where c.published order by c.created_at desc,c.id desc limit 1
$$;
create function public.community_post_json(p public.community_posts, viewer uuid, is_operator boolean) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'authorId',p.author_id,
 'authorName',coalesce((select nickname from public.profiles where id=p.author_id and deleted_at is null),'삭제된 계정'),
 'category',p.category,'campaignId',p.campaign_id,'title',p.title,'body',p.body,'answers',p.answers,
 'pinned',p.pinned,'hidden',p.hidden,
 'reactionCount',(select count(*) from public.community_reactions where post_id=p.id),
 'reacted',exists(select 1 from public.community_reactions where post_id=p.id and user_id=viewer),
 'commentCount',(select count(*) from public.community_comments where post_id=p.id and (not hidden or is_operator)),
 'createdAt',p.created_at,'updatedAt',p.updated_at,
 'editable',coalesce(p.author_id=viewer,false) and not p.hidden and (p.category<>'contest' or exists(select 1 from public.community_campaigns c where c.id=p.campaign_id and public.community_campaign_phase(c)='open')),
 'award',case when is_operator or exists(select 1 from public.community_campaigns c where c.id=p.campaign_id and c.published and c.results_published) then p.award else null end,
 'developmentStatus',p.development_status,'developmentNote',p.development_note)
$$;
create function public.community_comment_json(c public.community_comments) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'postId',c.post_id,'authorId',c.author_id,
 'authorName',coalesce((select nickname from public.profiles where id=c.author_id and deleted_at is null),'삭제된 계정'),
 'body',c.body,'hidden',c.hidden,'createdAt',c.created_at)
$$;

create function public.community_submission_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare campaign public.community_campaigns; changing boolean; field text; begin
 if tg_op='UPDATE' then
   if new.id<>old.id or new.category<>old.category or new.campaign_id is distinct from old.campaign_id or new.created_at<>old.created_at then
     raise exception 'community_invalid_input';
   end if;
   changing := (new.title,new.body,new.answers) is distinct from (old.title,old.body,old.answers);
 else changing := true; end if;
 if new.category='contest' and changing then
   select * into campaign from public.community_campaigns where id=new.campaign_id for share;
   if not found or public.community_campaign_phase(campaign)<>'open' then
     raise exception 'community_submission_locked';
   end if;
   if jsonb_typeof(new.answers)<>'object' then raise exception 'community_invalid_input'; end if;
   foreach field in array array['audience','problem','workflow','example'] loop
     if jsonb_typeof(new.answers->field) is distinct from 'string' or char_length(btrim(new.answers->>field)) not between 1 and 3000 then raise exception 'community_invalid_input'; end if;
   end loop;
   if (new.answers - array['audience','problem','workflow','example']) <> '{}'::jsonb then raise exception 'community_invalid_input'; end if;
 end if;
 if changing then new.updated_at:=clock_timestamp(); end if;
 return new;
end $$;
create trigger community_submission_guard before insert or update on public.community_posts for each row execute function public.community_submission_guard();
create function public.community_capture_submission() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.category='contest' and (tg_op='INSERT' or (new.title,new.body,new.answers) is distinct from (old.title,old.body,old.answers)) then
   insert into public.community_submission_snapshots(post_id,campaign_id,title,body,answers) values(new.id,new.campaign_id,new.title,new.body,new.answers);
 end if;
 return new;
end $$;
create trigger community_capture_submission after insert or update on public.community_posts for each row execute function public.community_capture_submission();
create function public.community_snapshot_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'community_submission_locked'; end $$;
create trigger community_snapshot_immutable before update or delete on public.community_submission_snapshots for each row execute function public.community_snapshot_immutable();

create function public.community_request(action_input text,input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); is_operator boolean; campaign public.community_campaigns;
 p public.community_posts; c public.community_comments; previous public.community_requests;
 result jsonb; items jsonb; pid uuid; cid uuid; rid text; field text; n integer; page_count integer;
 cursor_post public.community_posts; choice text; target_award smallint;
 start_time timestamptz; end_time timestamptz; result_time timestamptz;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor) then raise exception 'sign_in_required' using errcode='42501'; end if;
 if input is null or jsonb_typeof(input)<>'object' or octet_length(input::text)>48000 then raise exception 'community_invalid_input'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended(actor::text,812));
 if exists(select 1 from public.bandal_account_deletions where user_id=actor) then raise exception 'account_deletion_in_progress' using errcode='42501'; end if;
 is_operator:=exists(select 1 from public.community_operators where user_id=actor);
 if action_input='context' then
   select * into campaign from public.community_campaigns where published or is_operator order by created_at desc,id desc limit 1;
   return jsonb_build_object('configured',true,'signedIn',true,'operator',is_operator,'campaign',case when campaign.id is null then null else public.community_campaign_json(campaign) end);
 end if;
 if action_input='posts' then
   if input ? 'category' and (input->>'category') not in ('contest','study','feedback') then raise exception 'community_invalid_input'; end if;
   if nullif(input->>'cursor','') is not null then
     select * into cursor_post from public.community_posts where id=(input->>'cursor')::uuid and (not hidden or is_operator);
     if not found then raise exception 'community_invalid_input'; end if;
   end if;
   select coalesce(jsonb_agg(public.community_post_json(q,actor,is_operator) order by q.pinned desc,q.created_at desc,q.id desc),'[]'::jsonb),count(*) into items,page_count
   from (select cp.* from public.community_posts cp where (not cp.hidden or is_operator)
     and (not input ? 'category' or cp.category=input->>'category')
     and (cp.campaign_id is null or is_operator or exists(select 1 from public.community_campaigns cc where cc.id=cp.campaign_id and cc.published))
     and (cursor_post.id is null or (cp.pinned,cp.created_at,cp.id)<(cursor_post.pinned,cursor_post.created_at,cursor_post.id))
     order by cp.pinned desc,cp.created_at desc,cp.id desc limit 31) q;
   return jsonb_build_object('posts',case when page_count>30 then items-30 else items end,'nextCursor',case when page_count>30 then items->29->>'id' else null end);
 end if;
 if action_input='reports' then
   if not is_operator then raise exception 'community_forbidden' using errcode='42501'; end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'postId',r.post_id,'commentId',r.comment_id,'reason',r.reason,'createdAt',r.created_at,'resolved',r.resolved) order by r.resolved,r.created_at),'[]'::jsonb) into result
   from (select * from public.community_reports order by resolved,created_at desc limit 200) r;
   return result;
 end if;
 if action_input in ('savePost','comment') then
   rid:=input->>'requestId';
   if rid is null or char_length(rid) not between 8 and 128 then raise exception 'community_invalid_input'; end if;
   perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||rid,901));
   select * into previous from public.community_requests where actor_id=actor and request_id=rid;
   if found then
     if previous.action<>action_input or previous.payload<>input then raise exception 'community_idempotency_conflict'; end if;
     return previous.response;
   end if;
 end if;
 if action_input not in ('post','savePost','comment','react','report','moderate','resolveReport','updateCampaign','reviewPost') then raise exception 'community_invalid_input'; end if;
 if action_input<>'post' then
   insert into public.community_rate_limits(actor_id,bucket,attempts) values(actor,date_trunc('minute',clock_timestamp()),1)
   on conflict(actor_id,bucket) do update set attempts=public.community_rate_limits.attempts+1 returning attempts into n;
   if n>60 then raise exception 'community_rate_limited'; end if;
   delete from public.community_rate_limits where actor_id=actor and bucket<clock_timestamp()-interval '1 day';
 end if;
 if action_input='updateCampaign' then
   if not is_operator then raise exception 'community_forbidden' using errcode='42501'; end if;
   select * into campaign from public.community_campaigns where id=input->>'id' for update;
   if not found then raise exception 'community_not_found'; end if;
   start_time:=nullif(input->>'startsAt','')::timestamptz; end_time:=nullif(input->>'endsAt','')::timestamptz; result_time:=nullif(input->>'resultsAt','')::timestamptz;
   if campaign.starts_at<=clock_timestamp() and (start_time,end_time) is distinct from (campaign.starts_at,campaign.ends_at) then raise exception 'community_schedule_locked'; end if;
   if coalesce((input->>'resultsPublished')::boolean,false) and (end_time is null or end_time>clock_timestamp()) then raise exception 'community_results_not_ready'; end if;
   update public.community_campaigns set title=btrim(input->>'title'),summary=btrim(input->>'summary'),rules=btrim(input->>'rules'),
     starts_at=start_time,ends_at=end_time,results_at=result_time,published=(input->>'published')::boolean,
     results_published=(input->>'resultsPublished')::boolean,closed=(input->>'closed')::boolean,updated_at=clock_timestamp()
     where id=campaign.id returning * into campaign;
   insert into public.community_audit(actor_id,action,detail) values(actor,action_input,jsonb_build_object('campaignId',campaign.id,'published',campaign.published,'resultsPublished',campaign.results_published,'startsAt',campaign.starts_at,'endsAt',campaign.ends_at));
   return public.community_campaign_json(campaign);
 end if;
 if action_input='resolveReport' then
   if not is_operator then raise exception 'community_forbidden' using errcode='42501'; end if;
   update public.community_reports set resolved=true where id=(input->>'id')::uuid;
   if not found then raise exception 'community_not_found'; end if;
   insert into public.community_audit(actor_id,action,detail) values(actor,action_input,jsonb_build_object('reportId',input->>'id'));
   return jsonb_build_object('ok',true);
 end if;
 if action_input='savePost' and not input ? 'id' then
   if not exists(select 1 from public.profiles where id=actor and deleted_at is null and nickname !~ '^user_[0-9a-f]+$') then raise exception 'community_profile_required'; end if;
   if input->>'category'='contest' then
     select * into campaign from public.community_campaigns where id=input->>'campaignId' for share;
     if not found or public.community_campaign_phase(campaign)<>'open' then raise exception 'community_campaign_not_open'; end if;
   end if;
   insert into public.community_posts(author_id,category,campaign_id,title,body,answers,development_status)
   values(actor,input->>'category',case when input->>'category'='contest' then input->>'campaignId' else null end,btrim(input->>'title'),btrim(input->>'body'),case when input->>'category'='contest' then input->'answers' else null end,case when input->>'category'='contest' then 'reviewing' else null end) returning * into p;
   result:=public.community_post_json(p,actor,is_operator);
 else
   pid:=case when action_input in ('post','savePost') then (input->>'id')::uuid else (input->>'postId')::uuid end;
   -- Campaign first, post second, matching the writer's FK/trigger lock order.
   -- Campaign updates never take post locks.
   select * into p from public.community_posts where id=pid;
   if not found or (p.hidden and not is_operator) then raise exception 'community_not_found'; end if;
   if p.campaign_id is not null then
     select * into campaign from public.community_campaigns where id=p.campaign_id for share;
     if not campaign.published and not is_operator then raise exception 'community_not_found'; end if;
   end if;
   select * into p from public.community_posts where id=pid for update;
   if not found or (p.hidden and not is_operator) then raise exception 'community_not_found'; end if;
   if action_input='post' then
     select coalesce(jsonb_agg(public.community_comment_json(cc) order by cc.created_at,cc.id),'[]'::jsonb) into items from public.community_comments cc where cc.post_id=pid and (not cc.hidden or is_operator);
     return jsonb_build_object('post',public.community_post_json(p,actor,is_operator),'comments',items);
   elsif action_input='savePost' then
     if p.author_id is distinct from actor or p.hidden then raise exception 'community_forbidden' using errcode='42501'; end if;
     if input->>'category' is distinct from p.category or (case when p.category='contest' then input->>'campaignId' else null end) is distinct from p.campaign_id then raise exception 'community_invalid_input'; end if;
     if p.category='contest' and public.community_campaign_phase(campaign)<>'open' then raise exception 'community_submission_locked'; end if;
     update public.community_posts set title=btrim(input->>'title'),body=btrim(input->>'body'),answers=case when p.category='contest' then input->'answers' else null end where id=pid returning * into p;
     result:=public.community_post_json(p,actor,is_operator);
   elsif action_input='comment' then
     if not exists(select 1 from public.profiles where id=actor and deleted_at is null and nickname !~ '^user_[0-9a-f]+$') then raise exception 'community_profile_required'; end if;
     insert into public.community_comments(post_id,author_id,body) values(pid,actor,btrim(input->>'body')) returning * into c;
     result:=public.community_comment_json(c);
   elsif action_input='react' then
     if jsonb_typeof(input->'active') is distinct from 'boolean' then raise exception 'community_invalid_input'; end if;
     if (input->>'active')::boolean then insert into public.community_reactions(post_id,user_id) values(pid,actor) on conflict do nothing;
     else delete from public.community_reactions where post_id=pid and user_id=actor; end if;
     return jsonb_build_object('count',(select count(*) from public.community_reactions where post_id=pid),'active',(input->>'active')::boolean);
   elsif action_input='report' then
     cid:=nullif(input->>'commentId','')::uuid;
     if cid is not null and not exists(select 1 from public.community_comments where id=cid and post_id=pid and not hidden) then raise exception 'community_not_found'; end if;
     insert into public.community_reports(post_id,comment_id,reporter_id,reason) values(pid,cid,actor,btrim(input->>'reason')) on conflict do nothing;
     return jsonb_build_object('ok',true);
   elsif action_input='moderate' then
     if not is_operator then raise exception 'community_forbidden' using errcode='42501'; end if;
     choice:=input->>'action';
     if choice in ('pin','unpin') then update public.community_posts set pinned=choice='pin' where id=pid;
     elsif choice in ('hide','restore') then update public.community_posts set hidden=choice='hide' where id=pid;
     elsif choice in ('hideComment','restoreComment') then
       cid:=(input->>'commentId')::uuid;
       update public.community_comments set hidden=choice='hideComment' where id=cid and post_id=pid;
       if not found then raise exception 'community_not_found'; end if;
     else raise exception 'community_invalid_input'; end if;
     insert into public.community_audit(actor_id,action,post_id,detail) values(actor,choice,pid,jsonb_build_object('commentId',cid));
     return jsonb_build_object('ok',true);
   elsif action_input='reviewPost' then
     if not is_operator then raise exception 'community_forbidden' using errcode='42501'; end if;
     target_award:=(input->>'award')::smallint;
     if target_award is not null and (p.category<>'contest' or campaign.ends_at is null or campaign.ends_at>clock_timestamp()) then raise exception 'community_results_not_ready'; end if;
     begin
       update public.community_posts set award=target_award,development_status=input->>'developmentStatus',development_note=coalesce(input->>'developmentNote','') where id=pid returning * into p;
     exception when unique_violation then raise exception 'community_award_taken'; end;
     insert into public.community_audit(actor_id,action,post_id,detail) values(actor,action_input,pid,jsonb_build_object('award',p.award,'developmentStatus',p.development_status,'developmentNote',p.development_note));
     return public.community_post_json(p,actor,is_operator);
   end if;
 end if;
 if result is null then raise exception 'community_invalid_input'; end if;
 insert into public.community_requests(actor_id,request_id,action,payload,response) values(actor,rid,action_input,input,result);
 return result;
exception when invalid_text_representation or datetime_field_overflow or not_null_violation or check_violation or string_data_right_truncation then
 raise exception 'community_invalid_input';
end $$;

-- New tables participate in the existing account-deletion write freeze. FKs
-- remove memberships, reactions, reports and replay receipts on Auth deletion;
-- posts/comments remain with a null author and no copied nickname.
do $$ declare t text; f record; begin
 foreach t in array array['community_campaigns','community_operators','community_posts','community_submission_snapshots','community_comments','community_reactions','community_reports','community_requests','community_rate_limits','community_audit'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('grant all on public.%I to service_role',t);
   execute format('create trigger account_deletion_write_guard before insert or update on public.%I for each row execute function public.bandal_account_write_guard()',t);
 end loop;
 -- Supabase default privileges grant EXECUTE directly to authenticated, so
 -- revoking PUBLIC alone would leave internal projection/trigger helpers open.
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'community_%' loop
   execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.community_public_campaign() to anon,authenticated;
grant execute on function public.community_request(text,jsonb) to authenticated;
