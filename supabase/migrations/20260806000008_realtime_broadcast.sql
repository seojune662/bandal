-- ============================================================================
-- [C9] Bandal Phase 2 — 0008_realtime_broadcast.sql   (§4.1)
--
-- 만드는 것:
--   * public.broadcast_message()        — AFTER INSERT: realtime.send(… 'msg' …)
--   * public.broadcast_message_update() — AFTER UPDATE: 'msg_update'
--   * realtime.messages RLS 2정책       — private 채널 'group:<uuid>' 인가
--
-- 의존: 0001(is_group_member), 0002(profiles), 0006(messages)
--
-- ★ 왜 postgres_changes 가 아니라 Broadcast from Database 인가(§4.1)
--   postgres_changes 는 Realtime 서버가 **구독 클라이언트마다 RLS 를 재평가**한다.
--   비용이 (클라이언트 수 × 변경 건수)로 커져 무료 티어 동시 200에서 가장 먼저
--   무너진다. 게다가 페이로드가 원시 row diff 라 닉네임 조인이 클라이언트 몫이다.
--   AFTER INSERT 트리거의 realtime.send() 는 변경 1건당 1회 발행(O(1))이고
--   **페이로드 모양을 우리가 정한다** → 아래처럼 작성자 닉네임/아바타를 실어 보내면
--   렌더러는 조인 왕복이 0이다.
--
-- ⚠ 클라이언트는 supabase.realtime.setAuth() 로 JWT 를 채널에 실어야 한다.
--   빼먹으면 **조용히 아무것도 안 온다** — 대표적 디버깅 지옥이다(§8 위험 목록).
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 0. realtime.send 존재 확인 (§4.1 폴백 조건)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'realtime' and p.proname = 'send'
  ) then
    raise notice '[0008] realtime.send() 가 없습니다. 이 프로젝트의 Realtime 버전이 낮습니다.';
    raise notice '[0008] §4.1 폴백: postgres_changes + filter 어댑터로 내려가세요.';
    raise notice '[0008] (아래 트리거는 그대로 생성되지만 INSERT 시 런타임 오류가 납니다)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. AFTER INSERT — 메시지 브로드캐스트
-- ---------------------------------------------------------------------------
-- 토픽은 'group:<group_id>' 다. realtime.messages 정책(3절)이 이 접두어를 판정한다.
-- private := true → 구독 시 JWT 인가가 강제된다.
--
-- ★ 페이로드는 GroupEvent 'message' 의 GroupMessage 모양 그대로다(§4.8 [C8]).
--   author 를 여기 실어 보내는 게 이 방식의 핵심 이득이다.
create or replace function public.broadcast_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author public.profiles%rowtype;
begin
  select * into v_author from public.profiles p where p.id = new.author_id;

  perform realtime.send(
    jsonb_build_object(
      'id',        new.id,
      'groupId',   new.group_id,
      'seq',       new.seq,
      'authorId',  new.author_id,
      'kind',      new.kind,
      'body',      new.body,
      'replyTo',   new.reply_to,
      'createdAt', new.created_at,
      'editedAt',  null,
      'deleted',   false,
      'author',    jsonb_build_object(
                     'nickname',    coalesce(v_author.nickname, ''),
                     'avatarColor', coalesce(v_author.avatar_color, 'moon'),
                     'avatarEmoji', coalesce(v_author.avatar_emoji, '🌙')
                   )
    ),
    'msg',                              -- event
    'group:' || new.group_id::text,     -- topic
    true                                -- private
  );
  return null;
end;
$$;

comment on function public.broadcast_message() is
  '§4.1 Broadcast from Database. 변경 1건당 1회 발행. 작성자 프로필을 페이로드에 포함.';

drop trigger if exists messages_broadcast_insert on public.messages;
create trigger messages_broadcast_insert
  after insert on public.messages
  for each row execute function public.broadcast_message();

-- ---------------------------------------------------------------------------
-- 2. AFTER UPDATE — 편집/삭제 브로드캐스트
-- ---------------------------------------------------------------------------
-- GroupEvent 'message-updated' 에 대응한다(§4.8 [C8]).
-- 삭제된 메시지는 body 를 실어 보내지 않는다 — 삭제 후에도 본문이 흘러가면
-- "삭제"가 의미를 잃는다.
create or replace function public.broadcast_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.body is not distinct from old.body
     and new.deleted_at is not distinct from old.deleted_at then
    return null;   -- 의미 있는 변경이 없으면 방송하지 않는다(쿼터 절약)
  end if;

  perform realtime.send(
    jsonb_build_object(
      'messageId', new.id,
      'groupId',   new.group_id,
      'seq',       new.seq,
      'body',      case when new.deleted_at is null then to_jsonb(new.body) else 'null'::jsonb end,
      'deleted',   new.deleted_at is not null,
      'editedAt',  new.edited_at
    ),
    'msg_update',
    'group:' || new.group_id::text,
    true
  );
  return null;
end;
$$;

drop trigger if exists messages_broadcast_update on public.messages;
create trigger messages_broadcast_update
  after update on public.messages
  for each row execute function public.broadcast_message_update();

revoke execute on function public.broadcast_message()        from public, anon, authenticated;
revoke execute on function public.broadcast_message_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. realtime.messages RLS — private 채널 인가 (§4.1)
-- ---------------------------------------------------------------------------
-- 토픽 'group:<uuid>' 에서 7번째 글자부터가 uuid 다 ('group:' 은 6자).
-- SELECT  = 구독(수신) 인가
-- INSERT  = 채널로의 발신 인가. P2 에서 클라이언트 발신 메시지는 없지만
--           **Presence track 이 이 정책을 탄다**(§4.6 프레즌스는 만든다).
--
-- ★ 여기서도 is_group_member 헬퍼만 부른다. group_members 를 직접 참조하면
--   realtime 스키마에서 public RLS 를 다시 타게 되어 재귀 위험이 생긴다.
--
-- ★ 토픽 파싱을 정책 식에 인라인하지 않고 헬퍼로 뺀 이유:
--   `topic like 'group:%' and substring(topic from 7)::uuid = …` 는 AND 의 평가
--   순서를 SQL 이 보장하지 않으므로, 'group:hello' 같은 토픽에서 캐스트가 먼저
--   평가되면 22P02(invalid input syntax for uuid)로 **정책 자체가 에러를 던진다**.
--   헬퍼는 정규식으로 검사한 뒤에만 캐스트하고, 아니면 NULL 을 돌려준다.
--   is_group_member(NULL, uid) = false 이므로 안전하게 거절된다.
create or replace function public.realtime_group_id(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
           when p_topic ~ '^group:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then substring(p_topic from 7)::uuid
           else null
         end;
$$;

comment on function public.realtime_group_id(text) is
  '§4.1 realtime 토픽 "group:<uuid>" → uuid. 형식이 아니면 NULL(캐스트 예외 방지).';

revoke execute on function public.realtime_group_id(text) from public, anon;
grant  execute on function public.realtime_group_id(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice '[0008] realtime 스키마가 없습니다. Realtime 이 비활성인 프로젝트입니다 — 정책을 건너뜁니다.';
    return;
  end if;

  execute 'drop policy if exists "bandal group members can receive" on realtime.messages';
  execute $p$
    create policy "bandal group members can receive" on realtime.messages
      for select to authenticated
      using (
        public.is_group_member(
          public.realtime_group_id(realtime.topic()),
          (select auth.uid())
        )
      )
  $p$;

  execute 'drop policy if exists "bandal group members can send" on realtime.messages';
  execute $p$
    create policy "bandal group members can send" on realtime.messages
      for insert to authenticated
      with check (
        public.is_group_member(
          public.realtime_group_id(realtime.topic()),
          (select auth.uid())
        )
      )
  $p$;

  raise notice '[0008] realtime.messages 정책 2종을 생성했습니다.';
exception when insufficient_privilege then
  raise notice '[0008] realtime.messages 에 정책을 만들 권한이 없습니다.';
  raise notice '[0008] 대시보드 SQL 에디터(postgres 롤)에서 이 파일을 다시 실행하세요.';
end;
$$;

reset check_function_bodies;
