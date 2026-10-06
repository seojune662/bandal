-- Isolated PostgreSQL regression; never run against an existing database.
-- Creates only minimal Auth/Storage/schema stubs, then applies the real policies.
-- psql -X -v ON_ERROR_STOP=1 -d <empty-test-db> -f supabase/tests/whiteboard_asset_boundaries.sql
\ir fixtures/whiteboard_asset_schema.sql
\ir ../migrations/20260907000000_whiteboard_assets.sql
\ir ../migrations/20261007000000_whiteboard_asset_boundaries.sql

begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
insert into public.whiteboard_assets(id,board_id,group_id,author_id,storage_path,label,mime_type,width_px,height_px)
values('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/test.webp','test','image/webp',1,1);
do $$ begin
  begin
    insert into public.whiteboard_assets(id,board_id,group_id,author_id,storage_path,label,mime_type,width_px,height_px)
    values('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2','dddddddd-dddd-dddd-dddd-dddddddddddd','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/dddddddd-dddd-dddd-dddd-dddddddddddd/test.webp','test','image/webp',1,1);
    raise exception 'FAIL: cross-group metadata accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.whiteboard_assets set storage_path='outside/board/image.webp';
    raise exception 'FAIL: metadata path escaped its board';
  exception when insufficient_privilege then null; end;
end $$;
insert into storage.objects values('ffffffff-ffff-ffff-ffff-ffffffffffff','whiteboard-assets','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/test.webp','11111111-1111-1111-1111-111111111111');
update storage.objects set name='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/renamed.webp';
do $$ begin
  begin
    update storage.objects set name='not-a-member/not-a-board/test.webp';
    raise exception 'FAIL: object moved outside permitted board';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.memberships;
set local role authenticated;
do $$ declare changed integer; begin
  update storage.objects set name='after-leaving/test.webp';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: former member changed object'; end if;
  update public.whiteboard_assets set label='after leaving';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: former member changed metadata'; end if;
end $$;
reset role;
rollback;
select 'PASS: valid write, cross-group metadata, metadata path, object path, former-member object and metadata updates' as result;
