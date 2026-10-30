-- sync-write-block.sql을 되돌린다. 차단 뒤 예상하지 못한 문제가 생겼을 때만 실행한다.
-- 정책 정의는 migrations/20261015020000_sync_paid_access.sql과 같다.
begin;

grant execute on function public.bandal_push(jsonb) to authenticated;
drop policy if exists bandal_assets_create on storage.objects;
create policy bandal_assets_create on storage.objects for insert to authenticated with check (
  bucket_id='bandal-assets' and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{64}$')
  and (public.bandal_sync_status()->>'writeAllowed')::boolean
);

commit;
