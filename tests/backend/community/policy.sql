create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is not true then raise exception 'FAIL: %',label; end if;
end $$;
create function public.test_reject(sql text,fragment text) returns void language plpgsql as $$ declare rejected boolean:=false; begin
 begin execute sql; exception when others then
   if position(fragment in sqlerrm)=0 then raise exception 'Unexpected error (expected %): %',fragment,sqlerrm; end if;
   rejected:=true;
 end;
 if not rejected then raise exception 'Expected rejection: %',fragment; end if;
end $$;
grant execute on function public.test_assert(boolean,text),public.test_reject(text,text) to anon,authenticated;

select public.test_assert(not exists(select 1 from pg_tables where schemaname='public' and tablename like 'community_%' and (has_table_privilege('anon','public.'||tablename,'SELECT') or has_table_privilege('authenticated','public.'||tablename,'SELECT,INSERT,UPDATE,DELETE'))),'no direct table privilege');
select public.test_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'community_%' and p.proname not in ('community_request','community_public_campaign') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),'helper RPC privileges revoked including defaults');
set role anon;
select public.test_assert(public.community_public_campaign() is null,'unpublished campaign invisible');
select public.test_reject($q$select public.community_request('context','{}')$q$,'permission denied');
select public.test_reject('select * from public.community_posts','permission denied');
reset role;
insert into public.community_operators(user_id) values('33333333-3333-4333-8333-333333333333'),('55555555-5555-4555-8555-555555555555');
select public.test_reject($q$update public.community_campaigns set published=true where id='study-tools-2026'$q$,'violates check constraint');
select public.test_reject($q$update public.community_campaigns set title=' ' where id='study-tools-2026'$q$,'violates check constraint');
select public.test_reject($q$update public.community_campaigns set rules=' ' where id='study-tools-2026'$q$,'violates check constraint');
update public.community_campaigns set published=true,starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()+interval '1 hour',results_at=clock_timestamp()+interval '2 hours' where id='study-tools-2026';
set role anon;
select public.test_assert((public.community_public_campaign()->>'phase')='open','public phase derived from server time');
select public.test_assert(not public.community_public_campaign() ?| array['posts','authorId','operator','comments'],'public metadata has no content or identity');
reset role;

do $$ declare first_post jsonb; edited jsonb; second_post jsonb; other_post jsonb; result jsonb; request jsonb; comment jsonb; snapshot_count integer; campaign_input jsonb; begin
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
 set local role authenticated;
 perform public.test_assert((public.community_request('context','{}')->>'operator')='false','ordinary member not operator');
 request:='{"requestId":"contest-create-1","category":"contest","campaignId":"study-tools-2026","title":"영어 표현 연결","body":"","answers":{"audience":"영어를 공부하는 학생","problem":"표현을 잊어버림","workflow":"읽기 → 표현 수집 → 다시 사용","example":"기사에서 배운 말을 새 문장에 사용"}}';
 first_post:=public.community_request('savePost',request);
 perform public.test_assert(first_post->>'title'='영어 표현 연결' and first_post->>'body'='','creates real form contest post with answers and empty body');
 perform public.test_assert(public.community_request('savePost',request)=first_post,'same request returns same receipt');
 perform public.test_reject(format('select public.community_request(''savePost'',%L)',(request||'{"title":"변경"}')::text),'community_idempotency_conflict');
 edited:=public.community_request('savePost',request||jsonb_build_object('id',first_post->>'id','requestId','contest-edit-1','title','표현 연결 개선'));
 perform public.test_assert(edited->>'title'='표현 연결 개선','author edit accepted before deadline');
 second_post:=public.community_request('savePost',request||'{"requestId":"contest-create-2","title":"두번째 제안"}');
 perform public.test_assert((public.community_request('posts','{}')->'posts') @> jsonb_build_array(jsonb_build_object('id',first_post->>'id')),'feed returns post');
 result:=public.community_request('react',jsonb_build_object('postId',first_post->>'id','active',true));
 perform public.test_assert(result='{"count":1,"active":true}'::jsonb,'reaction count');
 perform public.test_assert(public.community_request('react',jsonb_build_object('postId',first_post->>'id','active',true))=result,'duplicate reaction unchanged');
 comment:=public.community_request('comment',jsonb_build_object('postId',first_post->>'id','requestId','comment-create-1','body','좋은 제안입니다.'));
 perform public.test_assert(public.community_request('comment',jsonb_build_object('postId',first_post->>'id','requestId','comment-create-1','body','좋은 제안입니다.'))=comment,'comment retry no duplicate');
 perform public.community_request('report',jsonb_build_object('postId',first_post->>'id','reason','검토 요청'));
 perform public.community_request('report',jsonb_build_object('postId',first_post->>'id','reason','검토 요청'));
 perform public.test_reject('select public.community_request(''reports'',''{}'')','community_forbidden');
 perform public.test_reject(format('select public.community_request(''moderate'',%L)',jsonb_build_object('postId',first_post->>'id','action','pin')::text),'community_forbidden');
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
 perform public.test_reject(format('select public.community_request(''savePost'',%L)',(request||jsonb_build_object('id',first_post->>'id','requestId','foreign-edit-1'))::text),'community_forbidden');
 other_post:=public.community_request('savePost','{"requestId":"other-study-1","category":"study","title":"공부법","body":"매일 복습해요."}');
 perform public.test_reject(format('select public.community_request(''report'',%L)',jsonb_build_object('postId',other_post->>'id','commentId',comment->>'id','reason','다른 글 댓글')::text),'community_not_found');
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
 perform public.test_assert((public.community_request('context','{}')->>'operator')='true','operator context');
 perform public.test_assert(jsonb_array_length(public.community_request('reports','{}'))=1,'report uniqueness');
 perform public.community_request('moderate',jsonb_build_object('postId',first_post->>'id','action','pin'));
 perform public.community_request('moderate',jsonb_build_object('postId',first_post->>'id','action','hideComment','commentId',comment->>'id'));
 perform public.community_request('moderate',jsonb_build_object('postId',other_post->>'id','action','hide'));
 perform public.test_reject(format('select public.community_request(''reviewPost'',%L)',jsonb_build_object('postId',first_post->>'id','award',1,'developmentStatus','planned','developmentNote','검토')::text),'community_results_not_ready');
 -- Development progress is independent from award selection, even before judging.
 result:=public.community_request('reviewPost',jsonb_build_object('postId',first_post->>'id','award',null,'developmentStatus','developing','developmentNote','검토 진행'));
 perform public.test_assert(result->>'developmentStatus'='developing' and result->'award'='null'::jsonb,'development independent from award');
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
 perform public.test_reject(format('select public.community_request(''post'',%L)',jsonb_build_object('id',other_post->>'id')::text),'community_not_found');
 result:=public.community_request('post',jsonb_build_object('id',first_post->>'id'));
 perform public.test_assert(jsonb_array_length(result->'comments')=0,'hidden comment excluded');
 perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
 perform public.community_request('savePost',request||'{"requestId":"contest-delete-1","title":"탈퇴시 보존 제안"}');
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
 reset role;
 select count(*) into snapshot_count from public.community_submission_snapshots where post_id=(first_post->>'id')::uuid;
 perform public.test_assert(snapshot_count=2,'create and edit each preserve a snapshot');
 perform public.test_assert((select title from public.community_submission_snapshots where post_id=(first_post->>'id')::uuid order by captured_at desc,id desc limit 1)='표현 연결 개선','latest accepted revision is judging copy');
 update public.community_campaigns set ends_at=clock_timestamp()-interval '1 minute' where id='study-tools-2026';
 set local role authenticated;
 perform public.test_assert(public.community_request('savePost',request)=first_post,'retry of accepted create still succeeds after deadline');
 perform public.test_reject(format('select public.community_request(''savePost'',%L)',(request||jsonb_build_object('id',first_post->>'id','requestId','late-edit-1'))::text),'community_submission_locked');
 perform public.test_reject(format('select public.community_request(''savePost'',%L)',(request||'{"requestId":"late-create-1"}')::text),'community_campaign_not_open');
 perform public.test_assert((public.community_request('post',jsonb_build_object('id',first_post->>'id'))->'post'->>'editable')='false','deadline makes edit unavailable');
 reset role;
 perform public.test_reject(format('update public.community_posts set title=''late direct change'' where id=%L',first_post->>'id'),'community_submission_locked');
 perform public.test_reject(format('update public.community_submission_snapshots set title=''changed'' where post_id=%L',first_post->>'id'),'community_submission_locked');
 perform public.test_reject(format('delete from public.community_submission_snapshots where post_id=%L',first_post->>'id'),'community_submission_locked');
 set local role authenticated;
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
 result:=public.community_request('reviewPost',jsonb_build_object('postId',first_post->>'id','award',2,'developmentStatus','available','developmentNote','학습에서 사용 가능'));
 perform public.test_assert(result->>'award'='2','operator can assign award after close');
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
 perform public.test_assert(public.community_request('post',jsonb_build_object('id',first_post->>'id'))->'post'->'award'='null'::jsonb,'unannounced award private');
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
 campaign_input:=public.community_request('context','{}')->'campaign';
 campaign_input:=campaign_input||'{"resultsPublished":true,"closed":false}';
 perform public.community_request('updateCampaign',campaign_input);
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
 perform public.test_assert(public.community_request('post',jsonb_build_object('id',first_post->>'id'))->'post'->>'award'='2','published award visible');
 reset role;
 -- Keep both contest awards empty for the concurrent uniqueness test.
 update public.community_posts set award=null;
end $$;

-- Account deletion: all new writes freeze, user references disappear via FKs,
-- while the public contribution and immutable judging copies retain no nickname.
do $$ declare post jsonb; begin
 perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
 set local role authenticated;
 post:=public.community_request('savePost','{"requestId":"deleted-study-1","category":"study","title":"남길 공부법","body":"이름을 복제하지 않아요."}');
 reset role;
 insert into public.bandal_account_deletions values('44444444-4444-4444-8444-444444444444');
 set local role authenticated;
 perform public.test_reject('select public.community_request(''savePost'',''{"requestId":"deleted-study-2","category":"study","title":"실패","body":"실패"}'')','account_deletion_in_progress');
 reset role;
 perform set_config('request.jwt.claim.sub','',false);
 delete from auth.users where id='44444444-4444-4444-8444-444444444444';
 perform public.test_assert((select author_id is null from public.community_posts where id=(post->>'id')::uuid),'deleted author reference removed');
 perform public.test_assert(exists(select 1 from public.community_posts p join public.community_submission_snapshots s on s.post_id=p.id where p.title='탈퇴시 보존 제안' and p.author_id is null),'closed submission anonymized without changing snapshot');
 perform public.test_assert(not exists(select 1 from public.community_requests where actor_id='44444444-4444-4444-8444-444444444444'),'receipt with copied authorName removed');
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
 set local role authenticated;
 perform public.test_assert(public.community_request('post',jsonb_build_object('id',post->>'id'))->'post'->>'authorName'='삭제된 계정','deleted account display anonymous');
 perform public.test_assert(public.community_request('post',jsonb_build_object('id',post->>'id'))->'post'->>'editable'='false','deleted author cannot yield null editable flag');
 reset role;
end $$;
select 'PASS PostgreSQL access, RPC authorization, idempotency, moderation, deadline and snapshots, unpublished awards, and account deletion.';
