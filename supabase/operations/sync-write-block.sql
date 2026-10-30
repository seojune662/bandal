-- D0: Bandal Sync 서버 쓰기 차단. 대시보드 SQL Editor에서 파일 전체를 한 번에 실행한다.
-- 이미 설치된 옛 데스크톱 앱이 계속 올리는 두 경로를 닫는다.
--   1) public.bandal_push(jsonb) 실행 권한
--   2) storage.objects의 bandal_assets_create 정책(bandal-assets 버킷 업로드)
-- 읽기(bandal_pull, bandal_assets_read)는 서버 사본을 지우는 D0+30까지 회수 경로로 남긴다.
-- 끝의 확인이 하나라도 어긋나면 오류를 내고, 이 파일의 변경도 함께 취소된다.
-- 여러 번 실행해도 결과가 같다. 되돌리기: sync-write-block-rollback.sql
begin;

revoke execute on function public.bandal_push(jsonb) from public, anon, authenticated;
drop policy if exists bandal_assets_create on storage.objects;

do $$ begin
  if has_function_privilege('anon', 'public.bandal_push(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.bandal_push(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.bandal_push_unmetered(jsonb)', 'execute') then
    raise exception 'sync write block: bandal_push is still executable by clients';
  end if;
  -- 정책은 OR로 합쳐진다. 버킷을 가리지 않거나 bandal-assets를 허용하는 삽입 정책이 남으면 업로드가 열린다.
  if exists (select 1 from pg_policies
             where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'ALL')
               and (coalesce(with_check, qual, '') not like '%bucket_id%'
                    or coalesce(with_check, qual, '') like '%bandal-assets%')) then
    raise exception 'sync write block: an insert policy on storage.objects still admits bandal-assets';
  end if;
  if not has_function_privilege('authenticated', 'public.bandal_pull(bigint,integer)', 'execute')
     or not exists (select 1 from pg_policies
                    where schemaname = 'storage' and tablename = 'objects' and policyname = 'bandal_assets_read') then
    raise exception 'sync write block: read access was lost';
  end if;
end $$;

commit;
