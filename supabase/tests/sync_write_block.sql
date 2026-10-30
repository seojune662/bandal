-- Isolated PostgreSQL regression; never run against an existing database.
-- Applies the real personal-sync migrations to stubs, then the D0 write block and its rollback.
-- psql -X -v ON_ERROR_STOP=1 -d <empty-test-db> -f supabase/tests/sync_write_block.sql
\ir fixtures/sync_schema.sql
\ir ../migrations/20261013005000_personal_sync.sql
\ir ../migrations/20261015020000_sync_paid_access.sql

create function pg_temp.probe(expect_open boolean) returns void language plpgsql as $$
declare pushed boolean := true; uploaded boolean := true; begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin perform public.bandal_push('{}'::jsonb);
  exception when insufficient_privilege then pushed := false; when others then null; end;
  begin insert into storage.objects(bucket_id, name, metadata)
        values ('bandal-assets', '11111111-1111-1111-1111-111111111111/' || md5(random()::text) || md5(random()::text), '{"size":"1"}');
  exception when insufficient_privilege then uploaded := false; end;
  if pushed <> expect_open or uploaded <> expect_open then
    raise exception 'FAIL: expected writes open=%, got push=% upload=%', expect_open, pushed, uploaded;
  end if;
  perform public.bandal_pull(0, 10);
  if not exists(select 1 from storage.objects where bucket_id = 'bandal-assets') then
    raise exception 'FAIL: owner cannot read own assets';
  end if;
  reset role;
end $$;

begin; select pg_temp.probe(true); commit;
\ir ../operations/sync-write-block.sql
begin; select pg_temp.probe(false); rollback;
\ir ../operations/sync-write-block.sql
\ir ../operations/sync-write-block-rollback.sql
begin; select pg_temp.probe(true); rollback;
\ir ../operations/sync-write-block.sql
begin; select pg_temp.probe(false); rollback;
\echo 'sync write block: all checks passed'
