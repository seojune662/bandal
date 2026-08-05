-- ============================================================================
-- Bandal Phase 2 — seed.sql (로컬 개발 전용, 선택)
--
-- 🚨 **로컬(`supabase start` / `supabase db reset`) 전용이다.**
--    호스팅 프로젝트에 절대 실행하지 말 것. auth.users 에 직접 INSERT 하기 때문에
--    운영 인증 상태를 오염시킨다. `supabase db push` 는 이 파일을 적용하지 않는다.
--
-- 하는 일:
--   * 테스트 사용자 2명 (nari@local.test / dalgi@local.test, 비밀번호 password123)
--   * 0002 의 auth.users 트리거가 profiles 를 자동 생성 → 닉네임만 덮어쓴다
--   * 데모 그룹 1개 + 초대 코드 + 메시지 몇 줄
--
-- 실행:
--   supabase db reset        # migrations + seed 를 한 번에
--   또는  psql "$LOCAL_DB_URL" -f supabase/seed.sql
-- ============================================================================

do $$
declare
  v_nari  uuid := '11111111-1111-4111-8111-111111111111';
  v_dalgi uuid := '22222222-2222-4222-8222-222222222222';
  v_gid   uuid;
  v_seq   bigint;
begin
  -- 안전장치 ①: 로컬이 아닌 곳에서 실수로 돌리는 것을 막는다.
  if exists (select 1 from auth.users limit 1)
     and not exists (select 1 from auth.users where id in (v_nari, v_dalgi))
  then
    raise notice '[seed] auth.users 에 이미 실제 사용자가 있습니다. 시드를 건너뜁니다.';
    return;
  end if;

  -- 안전장치 ②: 이미 시드가 돌았으면 다시 만들지 않는다(멱등).
  if exists (select 1 from public.study_groups where owner_id = v_nari and deleted_at is null) then
    raise notice '[seed] 이미 시드 데이터가 있습니다. 건너뜁니다.';
    return;
  end if;

  -- ── 사용자 ────────────────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, extensions.crypt('password123', extensions.gen_salt('bf')),
         now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
         now(), now()
    from (values
      (v_nari,  'nari@local.test'),
      (v_dalgi, 'dalgi@local.test')
    ) as u(id, email)
  on conflict (id) do nothing;

  -- GoTrue v2 는 identities 행이 있어야 이메일 로그인을 붙여 준다.
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  select gen_random_uuid(), u.id, u.id::text,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
    from (values
      (v_nari,  'nari@local.test'),
      (v_dalgi, 'dalgi@local.test')
    ) as u(id, email)
  on conflict do nothing;

  -- 트리거가 만든 임시 닉네임을 읽기 좋은 값으로 바꾼다
  update public.profiles set nickname = '나리', avatar_color = 'moon',  avatar_emoji = '🌙'
   where id = v_nari;
  update public.profiles set nickname = '달기', avatar_color = 'peach', avatar_emoji = '🍑'
   where id = v_dalgi;

  -- ── 그룹 ──────────────────────────────────────────────────────────────
  -- create_group() RPC 는 auth.uid() 를 요구하므로 시드에서는 직접 넣는다.
  insert into public.study_groups (name, color, owner_id, member_count)
  values ('자료구조 3조', 'moon', v_nari, 0)
  returning id into v_gid;

  insert into public.group_members (group_id, user_id, role)
  values (v_gid, v_nari, 'owner'), (v_gid, v_dalgi, 'member');

  insert into public.invite_codes (code, group_id, created_by, expires_at, max_uses)
  values ('K7M2QX', v_gid, v_nari, now() + interval '7 days', 0)
  on conflict (code) do nothing;

  -- ── 메시지 ────────────────────────────────────────────────────────────
  -- BEFORE INSERT 트리거가 seq 를 할당한다. auth.uid() 가 없으므로 토큰 버킷은
  -- 건너뛴다(트리거의 v_uid is not null 조건) — 시드가 한도를 소모하지 않는다.
  insert into public.messages (id, group_id, author_id, kind, body) values
    (gen_random_uuid(), v_gid, v_nari,  'system', 'joined'),
    (gen_random_uuid(), v_gid, v_dalgi, 'system', 'joined'),
    (gen_random_uuid(), v_gid, v_nari,  'text',   '3주차 과제 어디까지 했어?'),
    (gen_random_uuid(), v_gid, v_dalgi, 'text',   '나 트리 부분 하다가 막혔어 ㅠ'),
    (gen_random_uuid(), v_gid, v_nari,  'text',   '내일 도서관에서 볼까');

  select g.last_msg_seq into v_seq from public.study_groups g where g.id = v_gid;

  -- 달기는 마지막 메시지만 안 읽은 상태
  update public.group_members set last_read_seq = greatest(0, v_seq - 1)
   where group_id = v_gid and user_id = v_dalgi;
  update public.group_members set last_read_seq = v_seq
   where group_id = v_gid and user_id = v_nari;

  raise notice '[seed] 완료. group_id=% code=K7M2QX 사용자=나리/달기 (비밀번호 password123)', v_gid;
end;
$$;
