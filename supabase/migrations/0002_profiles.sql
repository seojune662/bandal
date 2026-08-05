-- ============================================================================
-- [C9] Bandal Phase 2 — 0002_profiles.sql   (§2.1)
--
-- 만드는 것:
--   * public.profiles                    — 전역 유일 닉네임 + 색/이모지 아바타
--   * auth.users → profiles 자동 생성 트리거 (임시 닉네임 user_<8hex>)
--   * profiles 컬럼 화이트리스트 트리거
--   * profiles RLS 3정책 (SELECT / UPDATE / 소프트삭제)
--   * public.find_profile_by_nickname()   — 완전일치 전용 RPC, 30/분
--
-- 의존: 0001 (is_friend, shares_group_with, is_blocked_either_way, check_rate)
-- 이 파일에 의존: 0003~0007 전부 (모든 FK 가 profiles(id) 를 가리킨다)
--
-- ⚠ 아바타 이미지 업로드 없음(결정 #10). Storage 비용 0, 이미지 모더레이션 0.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nickname      text not null,
  -- 대소문자 무시 유일성을 위한 생성 컬럼. 검색도 이 컬럼으로 완전일치한다.
  nickname_key  text generated always as (lower(nickname)) stored,
  avatar_color  text not null default 'moon',
  avatar_emoji  text not null default '🌙',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint nickname_shape check (nickname ~ '^[가-힣a-zA-Z0-9_]{2,16}$')
);

-- ★ 전역 유일 닉네임(디스크리미네이터 없음, §2.1).
--   "별명으로 친구추가"가 한 필드 1스텝으로 끝나야 하기 때문.
create unique index if not exists profiles_nickname_key_uq
  on public.profiles (nickname_key)
  where deleted_at is null;

comment on table public.profiles is
  '§2.1 사용자 프로필. auth.users 트리거로 자동 생성되며 닉네임은 임시값에서 시작한다.';
comment on column public.profiles.nickname_key is
  'lower(nickname). 유일 인덱스와 완전일치 검색의 대상.';

-- ---------------------------------------------------------------------------
-- 2. auth.users → profiles 자동 생성
-- ---------------------------------------------------------------------------
-- 임시 닉네임 user_<8hex>. 렌더러는 이 패턴을 보고 "닉네임 정하기" 스텝을 띄운다.
-- 극히 드문 충돌(2^32)에 대비해 최대 5회 재시도한다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nick text;
  i      int;
begin
  for i in 1..5 loop
    v_nick := 'user_' || encode(extensions.gen_random_bytes(4), 'hex');
    begin
      insert into public.profiles (id, nickname)
      values (new.id, v_nick)
      on conflict (id) do nothing;
      return new;
    exception when unique_violation then
      -- nickname_key 충돌 → 다시 뽑는다
      null;
    end;
  end loop;

  -- 5회 전부 실패하면 uuid 앞 12자를 쓴다(충돌 확률 사실상 0)
  insert into public.profiles (id, nickname)
  values (new.id, 'user_' || replace(substr(new.id::text, 1, 11), '-', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  '§2.1 신규 auth.users 마다 profiles 행을 만든다. 닉네임은 임시값 user_<8hex>.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. 컬럼 화이트리스트 트리거 (§2.1 "컬럼 화이트리스트는 트리거")
-- ---------------------------------------------------------------------------
-- 아래 6절의 컬럼 단위 GRANT 와 이중 방어다. GRANT 는 "이 컬럼을 UPDATE 문에
-- 쓸 수 있는가"를, 트리거는 "실제 값이 바뀌었는가"를 막는다.
create or replace function public.profiles_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 불변 컬럼 — 어떤 경로로든 바뀌지 않는다
  new.id           := old.id;
  new.created_at   := old.created_at;
  new.updated_at   := now();

  -- 소프트 삭제는 본인만, 그리고 되돌릴 수 없다(계정 삭제는 auth 쪽 cascade)
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'profile_undelete_not_allowed' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_update_trg on public.profiles;
create trigger profiles_guard_update_trg
  before update on public.profiles
  for each row execute function public.profiles_guard_update();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- SELECT — 본인 / 친구 / 같은 그룹 사람만. 그 외에는 존재조차 보이지 않는다.
-- ★ 디렉토리 스크래핑 차단이 목적이다. 닉네임 검색은 테이블 SELECT 가 아니라
--   find_profile_by_nickname() RPC 를 탄다(레이트리밋 지점을 만들기 위해).
-- ★ 헬퍼는 전부 SECURITY DEFINER 라 group_members/friendships 의 RLS 를 타지 않는다
--   → 재귀 없음.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_friend(id, (select auth.uid()))
    or public.shares_group_with(id, (select auth.uid()))
  );

-- UPDATE — 본인 행만. 어떤 컬럼을 바꿀 수 있는지는 GRANT + 트리거가 정한다.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- INSERT / DELETE 정책은 만들지 않는다.
--   INSERT: handle_new_user() 트리거 전용 (SECURITY DEFINER 라 RLS 를 우회)
--   DELETE: 하드 삭제 없음. deleted_at 소프트 삭제만.

-- ---------------------------------------------------------------------------
-- 5. find_profile_by_nickname — 완전일치 전용 RPC (§2.1 / §5.3)
-- ---------------------------------------------------------------------------
-- ★ prefix/LIKE 금지. 서버에 프리픽스를 열면 닉네임 디렉토리가 통째로 긁힌다.
--   클라이언트의 프리픽스 자동완성은 "로컬 캐시"에서만 일어난다(§5.3).
-- ★ 차단 관계면 "없음"을 돌려준다 — 차단 사실을 노출하지 않기 위해 404 와
--   구분 불가능하게 만든다.
create or replace function public.find_profile_by_nickname(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_nickname is null or char_length(p_nickname) < 2 or char_length(p_nickname) > 16 then
    raise exception 'invalid_nickname' using errcode = 'P0001';
  end if;

  perform public.check_rate('find_profile_by_nickname', 30, interval '1 minute');

  select * into v_row
    from public.profiles p
   where p.nickname_key = lower(p_nickname)
     and p.deleted_at is null;

  if not found then
    return null;
  end if;
  if public.is_blocked_either_way(v_uid, v_row.id) then
    return null;   -- 차단은 "그런 사람 없음"과 구분되지 않는다
  end if;

  return jsonb_build_object(
    'id',           v_row.id,
    'nickname',     v_row.nickname,
    'avatarColor',  v_row.avatar_color,
    'avatarEmoji',  v_row.avatar_emoji,
    'isFriend',     public.is_friend(v_uid, v_row.id)
  );
end;
$$;

comment on function public.find_profile_by_nickname(text) is
  '§2.1 완전일치 전용 닉네임 조회. 30/분. 차단 상대는 null(=없음)로 응답.';

-- ---------------------------------------------------------------------------
-- 6. 권한
-- ---------------------------------------------------------------------------
-- Supabase default privileges 가 anon 에게도 전부 주므로 먼저 전부 회수한다.
revoke all on public.profiles from public, anon, authenticated;

grant select on public.profiles to authenticated;
-- ★ 컬럼 화이트리스트: 닉네임/아바타/소프트삭제만 UPDATE 가능.
--   nickname_key 는 생성 컬럼이라 애초에 쓸 수 없고, id/created_at 은 여기서 빠진다.
grant update (nickname, avatar_color, avatar_emoji, deleted_at) on public.profiles to authenticated;

revoke execute on function public.handle_new_user()               from public, anon, authenticated;
revoke execute on function public.profiles_guard_update()         from public, anon, authenticated;
revoke execute on function public.find_profile_by_nickname(text)  from public, anon;
grant  execute on function public.find_profile_by_nickname(text)  to authenticated;

reset check_function_bodies;
