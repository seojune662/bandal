-- ============================================================================
-- [C9] Bandal Phase 2 — 0006_messages.sql   (§2.7 / §4.3 / §6.1)
--
-- 만드는 것:
--   * public.messages                    — PK 는 클라이언트 생성(멱등 재전송)
--   * public.messages_before_insert()    — ★ seq 할당 + ★ 토큰 버킷 레이트리밋
--   * public.messages_before_update()    — 5분 편집 창 / 소프트삭제 규칙
--   * public.post_system_message()       — RPC 들이 부르는 system 메시지 헬퍼
--   * RPC: delete_message, load_messages
--   * RLS 3정책
--
-- 의존: 0001(헬퍼), 0002(profiles), 0003(study_groups.last_msg_seq, group_members)
-- 이 파일에 의존: 0008(브로드캐스트 트리거를 이 테이블에 붙인다), 0009(보존 정책)
--
-- ⚠ 이름 충돌 주의: 로컬 SQLite 의 messages(AI 튜터 대화)와 다른 테이블이다.
--   코드에서는 chatRepo/ChatMessage(로컬) vs groupRepo/GroupMessage(원격)로 나눈다(§3.4).
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. 테이블 (§2.7)
-- ---------------------------------------------------------------------------
-- ★ PK 를 클라이언트가 생성한다(uuid v4). 오프라인 아웃박스가
--   `on conflict do nothing` 으로 무한 재시도해도 중복이 안 생긴다(§4.4).
-- ★ 정렬은 created_at 이 아니라 seq. 클라이언트 시계 오차는 실재하고 채팅 순서가
--   뒤집히면 제품이 망가진다(§4.3).
create table if not exists public.messages (
  id         uuid primary key,
  group_id   uuid not null references public.study_groups(id),
  seq        bigint not null,
  author_id  uuid not null references public.profiles(id),
  kind       text not null default 'text' check (kind in ('text','system')),
  body       text not null check (char_length(body) between 1 and 4000),
  reply_to   uuid references public.messages(id),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  unique (group_id, seq)
);

-- 키셋 페이지네이션 전용 인덱스: where seq < $cursor order by seq desc limit 50 (§4.3)
create index if not exists messages_group_seq_idx on public.messages (group_id, seq desc);
create index if not exists messages_author_idx    on public.messages (author_id);

comment on table public.messages is
  '§2.7 그룹 채팅 메시지. id 는 클라이언트 생성(멱등), seq 는 트리거 할당(그룹별 단조).';
comment on column public.messages.seq is
  '§4.3 그룹별 연속 정수. 갭 감지(incoming.seq != lastSeq+1)와 키셋 페이지네이션의 근거.';

-- ---------------------------------------------------------------------------
-- 2. ★ BEFORE INSERT — seq 할당 + 토큰 버킷 (§4.3 / §6.1)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER 인 이유 2가지:
--   ① study_groups.last_msg_seq 를 올려야 하는데 클라이언트에는 그 컬럼 UPDATE
--      권한이 없다(0003 의 컬럼 GRANT 는 name/color 뿐).
--   ② group_members.msg_tokens/tokens_at 도 마찬가지다. 클라이언트가 토큰을
--      스스로 리필할 수 있으면 레이트리밋이 성립하지 않는다.
--
-- 잠금 순서는 항상 group_members → study_groups 다. 전 코드에서 이 순서를
-- 지켜야 교착이 생기지 않는다.
--
-- ★ 토큰 버킷(§6.1): 용량 20, 초당 2 리필.
--   rate_events 스캔과 달리 자기 행 UPDATE 하나로 O(1) 이다.
--   거절 시 raise 로 롤백돼도 정확하다 — 버킷은 (msg_tokens, tokens_at) 시간 기반
--   상태라 "소모하지 않은 것"이 곧 올바른 상태다.
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tokens real;
  v_seq    bigint;
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  new.created_at := coalesce(new.created_at, now());
  -- 클라이언트가 이 컬럼들을 위조해 보내도 무시한다
  new.edited_at  := null;
  new.deleted_at := null;

  -- 토큰 버킷은 사용자가 직접 보낸 text 메시지에만 적용한다.
  -- system 메시지는 RPC 가 발행하므로 auth.uid() 가 있어도 대상이 아니다.
  if v_uid is not null and new.kind = 'text' then
    select least(20::real,
                 m.msg_tokens + (extract(epoch from (now() - m.tokens_at)) * 2)::real)
      into v_tokens
      from public.group_members m
     where m.group_id = new.group_id
       and m.user_id  = v_uid
       and m.left_at is null
     for update;

    if v_tokens is null then
      raise exception 'not_a_member' using errcode = 'P0001';
    end if;

    -- ★ 21번째 메시지가 여기서 막힌다(용량 20).
    if v_tokens < 1 then
      raise exception 'rate_limited'
        using errcode = 'P0001', detail = 'message_send', hint = '1';
    end if;

    update public.group_members
       set msg_tokens = v_tokens - 1,
           tokens_at  = now()
     where group_id = new.group_id and user_id = v_uid;
  end if;

  -- ★ 그룹별 단조 시퀀스. update … returning 한 방으로 원자적이다.
  --   같은 그룹에 동시 INSERT 가 들어오면 이 UPDATE 의 행 잠금이 직렬화시킨다.
  update public.study_groups
     set last_msg_seq = last_msg_seq + 1,
         last_msg_at  = new.created_at,
         updated_at   = now()
   where id = new.group_id
     and deleted_at is null
   returning last_msg_seq into v_seq;

  if v_seq is null then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;

  new.seq := v_seq;
  return new;
end;
$$;

comment on function public.messages_before_insert() is
  '§4.3 seq 할당 + §6.1 토큰 버킷(용량 20 / 초당 2). 초과 시 P0001 rate_limited.';

drop trigger if exists messages_before_insert_trg on public.messages;
create trigger messages_before_insert_trg
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- ---------------------------------------------------------------------------
-- 3. BEFORE UPDATE — 편집/삭제 규칙 (§2.7)
-- ---------------------------------------------------------------------------
-- RLS 는 컬럼·시간 표현이 빈약하므로 역할을 나눈다:
--   RLS  = "이 행을 만질 수 있는 사람인가" (author_id = auth.uid())
--   트리거 = "무엇을 어떻게 바꿀 수 있는가" (5분 창, 소프트삭제, 불변 컬럼)
create or replace function public.messages_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- SECURITY DEFINER RPC(delete_message, 보존 정책) 경로는 통과시킨다.
  -- 판별은 GUC 가 아니라 "실행 롤이 테이블 소유자인가"로 한다(위조 불가).
  if current_user = pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid)
     ) then
    return new;
  end if;

  -- 불변 컬럼
  new.id         := old.id;
  new.group_id   := old.group_id;
  new.seq        := old.seq;
  new.author_id  := old.author_id;
  new.kind       := old.kind;
  new.reply_to   := old.reply_to;
  new.created_at := old.created_at;

  -- 이미 삭제된 메시지는 되살릴 수도, 편집할 수도 없다
  if old.deleted_at is not null then
    new.body       := old.body;
    new.deleted_at := old.deleted_at;
    return new;
  end if;

  -- 소프트 삭제: 작성자 본인만 이 경로로 온다(관리자 삭제는 delete_message RPC).
  if new.deleted_at is not null then
    if v_uid is distinct from old.author_id then
      raise exception 'not_authorized' using errcode = 'P0001';
    end if;
    new.body      := old.body;   -- 본문은 남기고 UI 가 "삭제된 메시지"로 렌더
    new.edited_at := old.edited_at;
    new.deleted_at := now();
    return new;
  end if;

  -- 본문 편집: 작성자 본인 + 5분 이내 + text 종류만
  if new.body is distinct from old.body then
    if v_uid is distinct from old.author_id then
      raise exception 'not_authorized' using errcode = 'P0001';
    end if;
    if old.kind <> 'text' then
      raise exception 'not_editable' using errcode = 'P0001';
    end if;
    if now() - old.created_at > interval '5 minutes' then
      raise exception 'edit_window_expired' using errcode = 'P0001';
    end if;
    new.edited_at := now();
    return new;
  end if;

  -- 아무것도 안 바뀐 UPDATE
  new.edited_at := old.edited_at;
  return new;
end;
$$;

drop trigger if exists messages_before_update_trg on public.messages;
create trigger messages_before_update_trg
  before update on public.messages
  for each row execute function public.messages_before_update();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.messages enable row level security;

-- SELECT — 그 그룹의 살아있는 멤버만. 탈퇴하면 과거 메시지도 안 보인다.
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_group_member(group_id, (select auth.uid())));

-- INSERT — 본인 명의 + text 한정 + 멤버.
-- ★ kind='system' 은 정책이 막는다. system 메시지는 SECURITY DEFINER RPC 만 발행.
-- ★ seq 는 여기서 검증하지 않는다(BEFORE INSERT 트리거가 덮어쓴다).
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and kind = 'text'
    and public.is_group_member(group_id, (select auth.uid()))
  );

-- UPDATE — 작성자 본인만(§2.7). 관리자 소프트삭제는 delete_message() RPC 경유.
drop policy if exists messages_update_author on public.messages;
create policy messages_update_author on public.messages
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- DELETE 정책 없음 — 하드 삭제 없음. 보존 정책(0009)만 물리 삭제한다.

revoke all on public.messages from public, anon, authenticated;
grant select, insert on public.messages to authenticated;
-- 편집·삭제로 바꿀 수 있는 컬럼만 열어 둔다.
grant update (body, deleted_at) on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- 5. post_system_message — RPC 들이 부르는 헬퍼
-- ---------------------------------------------------------------------------
-- 0003(leave/kick), 0004(join/코드 자동 revoke), 0005(초대 수락)이 이 함수를 부른다.
-- 본문은 **코드 문자열**이다. 사람이 읽는 문장은 렌더러가 만든다 — 서버가 한국어
-- 문장을 박아 두면 문구 수정이 마이그레이션이 되고 로컬라이즈가 불가능해진다.
--   'joined' | 'left' | 'kicked' | 'code_auto_revoked' | 'renamed'
create or replace function public.post_system_message(
  p_group_id uuid,
  p_actor_id uuid,
  p_event    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event !~ '^[a-z_]{1,40}$' then
    raise exception 'invalid_system_event' using errcode = 'P0001';
  end if;

  insert into public.messages (id, group_id, author_id, kind, body)
  values (gen_random_uuid(), p_group_id, p_actor_id, 'system', p_event);
end;
$$;

comment on function public.post_system_message(uuid, uuid, text) is
  'system 메시지 발행. body 는 이벤트 코드이며 문장은 렌더러가 만든다.';

-- ---------------------------------------------------------------------------
-- 6. RPC: delete_message — 작성자 또는 그룹 관리자 (§6.4 오너의 1차 대응)
-- ---------------------------------------------------------------------------
create or replace function public.delete_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_msg from public.messages m where m.id = p_message_id;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0001';
  end if;
  if not public.is_group_member(v_msg.group_id, v_uid) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;
  if v_msg.author_id <> v_uid and not public.is_group_admin(v_msg.group_id, v_uid) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if v_msg.deleted_at is not null then
    return jsonb_build_object('ok', true, 'alreadyDeleted', true);
  end if;

  update public.messages set deleted_at = now() where id = p_message_id;
  return jsonb_build_object('ok', true, 'messageId', p_message_id, 'seq', v_msg.seq);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: load_messages — 키셋 페이지네이션 (§4.3)
-- ---------------------------------------------------------------------------
-- 오프셋 금지. 신규 메시지가 들어오면 오프셋은 미끄러진다.
--   * p_before_seq 가 있으면  seq < cursor  (위로 스크롤)
--   * p_after_seq  가 있으면  seq > cursor  (재연결 캐치업)
-- 작성자 프로필을 조인해서 돌려준다 → 렌더러가 추가 왕복을 하지 않는다.
create or replace function public.load_messages(
  p_group_id   uuid,
  p_before_seq bigint default null,
  p_after_seq  bigint default null,
  p_limit      int    default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows  jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_group_member(p_group_id, v_uid) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  -- 창을 먼저 자르고(방향에 따라 desc/asc), 마지막에 항상 seq 오름차순으로 정렬해
  -- 돌려준다. 렌더러는 언제나 "오래된 것 → 최신" 순서를 받는다.
  with window_rows as (
    select m.*
      from public.messages m
     where m.group_id = p_group_id
       and (p_before_seq is null or m.seq < p_before_seq)
       and (p_after_seq  is null or m.seq > p_after_seq)
     order by case when p_after_seq is null then m.seq end desc,
              case when p_after_seq is not null then m.seq end asc
     limit v_limit
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',        w.id,
             'groupId',   w.group_id,
             'seq',       w.seq,
             'authorId',  w.author_id,
             'kind',      w.kind,
             'body',      case when w.deleted_at is null then to_jsonb(w.body) else 'null'::jsonb end,
             'replyTo',   w.reply_to,
             'createdAt', w.created_at,
             'editedAt',  w.edited_at,
             'deleted',   w.deleted_at is not null,
             'author',    jsonb_build_object(
                            'nickname',    p.nickname,
                            'avatarColor', p.avatar_color,
                            'avatarEmoji', p.avatar_emoji
                          )
           ) order by w.seq asc
         ), '[]'::jsonb)
    into v_rows
    from window_rows w
    join public.profiles p on p.id = w.author_id;

  return v_rows;
end;
$$;

comment on function public.load_messages(uuid, bigint, bigint, int) is
  '§4.3 키셋 페이지네이션. 작성자 프로필 포함 → 렌더러 조인 왕복 0.';

-- ---------------------------------------------------------------------------
-- 8. 권한
-- ---------------------------------------------------------------------------
revoke execute on function public.messages_before_insert()   from public, anon, authenticated;
revoke execute on function public.messages_before_update()   from public, anon, authenticated;
revoke execute on function public.post_system_message(uuid, uuid, text) from public, anon, authenticated;

revoke execute on function public.delete_message(uuid)                        from public, anon;
revoke execute on function public.load_messages(uuid, bigint, bigint, int)    from public, anon;

grant execute on function public.delete_message(uuid)                         to authenticated;
grant execute on function public.load_messages(uuid, bigint, bigint, int)     to authenticated;

reset check_function_bodies;
