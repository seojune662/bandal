-- Keep metadata and stored objects inside the same active board and group.
-- Qualify outer columns: bare group_id inside the subquery resolves to w.group_id.
drop policy if exists whiteboard_assets_select_member on public.whiteboard_assets;
create policy whiteboard_assets_select_member on public.whiteboard_assets
  for select to authenticated using (
    public.is_group_member(group_id, (select auth.uid()))
    and exists (
      select 1 from public.whiteboards w
       where w.id = whiteboard_assets.board_id
         and w.group_id = whiteboard_assets.group_id
         and w.deleted_at is null
    )
  );

drop policy if exists whiteboard_assets_insert_member on public.whiteboard_assets;
create policy whiteboard_assets_insert_member on public.whiteboard_assets
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and public.is_group_member(group_id, (select auth.uid()))
    and storage_path like group_id::text || '/' || board_id::text || '/%'
    and exists (
      select 1 from public.whiteboards w
       where w.id = whiteboard_assets.board_id
         and w.group_id = whiteboard_assets.group_id
         and w.deleted_at is null
    )
  );

drop policy if exists whiteboard_assets_update_author on public.whiteboard_assets;
create policy whiteboard_assets_update_author on public.whiteboard_assets
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and public.is_group_member(group_id, (select auth.uid()))
    and exists (
      select 1 from public.whiteboards w
       where w.id = whiteboard_assets.board_id
         and w.group_id = whiteboard_assets.group_id
         and w.deleted_at is null
    )
  )
  with check (
    author_id = (select auth.uid())
    and public.is_group_member(group_id, (select auth.uid()))
    and storage_path like group_id::text || '/' || board_id::text || '/%'
    and exists (
      select 1 from public.whiteboards w
       where w.id = whiteboard_assets.board_id
         and w.group_id = whiteboard_assets.group_id
         and w.deleted_at is null
    )
  );

drop policy if exists whiteboard_asset_objects_update on storage.objects;
create policy whiteboard_asset_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'whiteboard-assets'
    and owner_id = (select auth.uid()::text)
    and exists (
      select 1 from public.whiteboards w
       where w.group_id::text = (storage.foldername(name))[1]
         and w.id::text = (storage.foldername(name))[2]
         and w.deleted_at is null
         and public.is_group_member(w.group_id, (select auth.uid()))
    )
  )
  with check (
    bucket_id = 'whiteboard-assets'
    and owner_id = (select auth.uid()::text)
    and exists (
      select 1 from public.whiteboards w
       where w.group_id::text = (storage.foldername(name))[1]
         and w.id::text = (storage.foldername(name))[2]
         and w.deleted_at is null
         and public.is_group_member(w.group_id, (select auth.uid()))
    )
  );
