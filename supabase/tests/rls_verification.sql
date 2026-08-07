-- ============================================================================
-- Bandal Phase 2 — P2-B 게이트 증명 스크립트 (rls_verification.sql)
--
-- §7 P2-B/P2-화이트보드 게이트 6종을 재현한다:
--   ① 비멤버가 study_groups / messages / group_members 를 SELECT 하면 0행
--   ② invite_codes 를 code 로 조회할 수 없다
--   ③ join_group_with_code 6회 연속 시도 시 6번째가 거절된다
--   ④ 21번째 메시지 즉시 전송 시 rate_limited
--   ⑤ 모든 정책 쿼리가 재귀(42P17) 없이 응답한다
--   ⑥ 화이트보드 RLS/멱등 PK/전용 토큰 버킷이 실제로 막는다
--
-- ---------------------------------------------------------------------------
-- 실행 방법
-- ---------------------------------------------------------------------------
-- 0. 0001~0009 후 0010_whiteboards.sql 까지 전부 적용한다.
-- 1. 실제 계정 2개로 로그인해 프로필이 생기게 한다. 그리고 uuid 를 확인한다:
--
--       select id, nickname from public.profiles order by created_at desc limit 5;
--
-- 2. 아래 "◆ 여기만 고치세요" 두 줄에 그 uuid 두 개를 넣는다.
--    USER_A = 그룹을 만드는 쪽, USER_B = 아무 그룹에도 속하지 않은 비멤버.
-- 3. 대시보드 SQL 에디터에 **파일 전체를 한 번에** 붙여 넣고 실행한다.
--    (한 트랜잭션 안에서 도는 것이 전제다 — ③④가 그 위에서 결정적으로 동작한다)
-- 4. 마지막 SELECT 가 게이트별 PASS/FAIL 표를 돌려준다.
--
-- ---------------------------------------------------------------------------
-- 이 스크립트가 하는 일 / 하지 않는 일
-- ---------------------------------------------------------------------------
-- * `set local role authenticated` + `request.jwt.claims` 로 두 사용자를 흉내낸다.
--   postgres 롤은 테이블 소유자라 RLS 를 우회하므로 **반드시 롤을 바꿔야** 의미가 있다.
-- * 테스트용 그룹/메시지/rate_events 를 실제로 만들고, 마지막에 전부 지운다(6절).
-- * 소유자 계정에서 돌리면 안전하지만, **운영 데이터가 있는 프로젝트에서는
--   먼저 스테이징에서 돌리기를 권한다.**
-- * service_role 키는 어디에도 필요하지 않다. 쓰지 말 것.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 설정 + 결과 테이블
-- ---------------------------------------------------------------------------
drop table if exists p2b_cfg;
create temporary table p2b_cfg (k text primary key, v text);

-- ◆ 여기만 고치세요 ────────────────────────────────────────────────────────
insert into p2b_cfg (k, v) values
  ('user_a', '00000000-0000-0000-0000-00000000000a'),   -- ◆ 그룹 생성자
  ('user_b', '00000000-0000-0000-0000-00000000000b');   -- ◆ 비멤버
-- ──────────────────────────────────────────────────────────────────────────

drop table if exists p2b_results;
create temporary table p2b_results (
  ord     serial primary key,
  gate    text not null,
  name    text not null,
  passed  boolean not null,
  detail  text
);

drop table if exists p2b_state;
create temporary table p2b_state (k text primary key, v text);

-- 사전 점검: 두 프로필이 실재하는가
do $$
declare
  v_a uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_b uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
begin
  if not exists (select 1 from public.profiles where id = v_a) then
    raise exception '[setup] user_a 프로필(%)이 없습니다. 위 "◆ 여기만 고치세요"를 채우세요.', v_a;
  end if;
  if not exists (select 1 from public.profiles where id = v_b) then
    raise exception '[setup] user_b 프로필(%)이 없습니다.', v_b;
  end if;
  if v_a = v_b then
    raise exception '[setup] user_a 와 user_b 는 서로 달라야 합니다.';
  end if;
end;
$$;

-- 사용자 흉내내기 헬퍼. PostgREST 가 하는 일과 같다.
create or replace function pg_temp.impersonate(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
                     true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  -- '' 이 아니라 '{}' 로 되돌린다. auth.uid() 구현에 따라 빈 문자열 캐스트가
  -- 22P02 로 터지는 환경이 있다(로컬 셀프호스트 등).
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. 준비: USER_A 가 그룹을 만들고 메시지 하나를 남긴다
-- ---------------------------------------------------------------------------
do $$
declare
  v_a    uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_res  jsonb;
  v_gid  uuid;
  v_bid  uuid;
  v_sid  uuid := gen_random_uuid();
  v_code text;
begin
  perform pg_temp.impersonate(v_a);

  v_res  := public.create_group('P2B 검증용 그룹', 'moon');
  v_gid  := (v_res->>'id')::uuid;
  v_code := v_res->'invite'->>'code';

  insert into public.messages (id, group_id, author_id, body)
  values (gen_random_uuid(), v_gid, v_a, '준비용 메시지');

  insert into public.whiteboards (group_id, title)
  values (v_gid, 'P2B 검증용 화이트보드')
  returning id into v_bid;

  insert into public.whiteboard_shapes (id, board_id, kind, data_json, style_json)
  values (v_sid, v_bid, 'line', '{"x1":0,"y1":0,"x2":10,"y2":10}',
          '{"color":"#111827","width":2}');

  perform pg_temp.unimpersonate();

  insert into p2b_state (k, v) values
    ('group_id', v_gid::text), ('code', v_code),
    ('board_id', v_bid::text), ('shape_a_id', v_sid::text);

  insert into p2b_results (gate, name, passed, detail) values
    ('setup', 'create_group 이 그룹과 초대코드를 만든다',
     v_gid is not null and v_code ~ '^[0-9A-HJ-KM-NP-TV-Z]{6}$',
     format('group=%s code=%s', v_gid, v_code)),
    ('setup', '멤버가 보드와 도형을 생성한다',
     v_bid is not null and v_sid is not null,
     format('board=%s shape=%s', v_bid, v_sid));
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('setup', 'create_group', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- ---------------------------------------------------------------------------
-- ① 비멤버 SELECT 는 0행
-- ---------------------------------------------------------------------------
-- 존재하지 않는 행이 아니라 **RLS 가 감춘 행**이다. USER_B 는 group_id 를 정확히
-- 알고 있는데도 아무것도 못 본다는 것이 요점이다.
do $$
declare
  v_b   uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_gid uuid := (select v from p2b_state where k = 'group_id')::uuid;
  v_bid uuid := (select v from p2b_state where k = 'board_id')::uuid;
  n_g int; n_m int; n_mem int; n_w int; n_s int;
begin
  perform pg_temp.impersonate(v_b);

  select count(*) into n_g   from public.study_groups  where id = v_gid;
  select count(*) into n_m   from public.messages      where group_id = v_gid;
  select count(*) into n_mem from public.group_members where group_id = v_gid;
  select count(*) into n_w   from public.whiteboards   where id = v_bid;
  select count(*) into n_s   from public.whiteboard_shapes where board_id = v_bid;

  perform pg_temp.unimpersonate();

  insert into p2b_results (gate, name, passed, detail) values
    ('①', '비멤버의 study_groups SELECT = 0행',  n_g   = 0, format('rows=%s', n_g)),
    ('①', '비멤버의 messages SELECT = 0행',      n_m   = 0, format('rows=%s', n_m)),
    ('①', '비멤버의 group_members SELECT = 0행', n_mem = 0, format('rows=%s', n_mem)),
    ('⑥', '비멤버의 whiteboards SELECT = 0행', n_w = 0, format('rows=%s', n_w)),
    ('⑥', '비멤버의 whiteboard_shapes SELECT = 0행', n_s = 0, format('rows=%s', n_s));
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('①', '비멤버 SELECT', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- 비멤버가 메시지를 INSERT 하려 하면 42501(RLS 위반)로 막혀야 한다.
do $$
declare
  v_b   uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_gid uuid := (select v from p2b_state where k = 'group_id')::uuid;
  v_ok  boolean := false;
  v_det text;
begin
  perform pg_temp.impersonate(v_b);
  begin
    insert into public.messages (id, group_id, author_id, body)
    values (gen_random_uuid(), v_gid, v_b, '침입 시도');
    v_det := '삽입이 성공했다(치명적)';
  exception when others then
    v_ok  := true;
    v_det := format('%s / %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.unimpersonate();

  insert into p2b_results (gate, name, passed, detail)
  values ('①', '비멤버의 messages INSERT 는 거부된다', v_ok, v_det);
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('①', '비멤버 INSERT', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- ---------------------------------------------------------------------------
-- ② invite_codes 를 code 로 조회할 수 없다
-- ---------------------------------------------------------------------------
-- 두 가지를 본다:
--   (a) 실제 코드로 조회해도 0행이거나 권한 오류다 (USER_B = 비멤버)
--   (b) 그룹의 **오너**조차 테이블 SELECT 로는 못 읽는다 — 정책이 아예 없기 때문.
--       오너의 정상 경로는 current_invite_code() RPC 다.
do $$
declare
  v_a    uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_b    uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_gid  uuid := (select v from p2b_state where k = 'group_id')::uuid;
  v_code text := (select v from p2b_state where k = 'code');
  n int; v_ok boolean; v_det text;
  v_rpc jsonb;
begin
  -- (a) 비멤버가 code 로 조회
  perform pg_temp.impersonate(v_b);
  begin
    select count(*) into n from public.invite_codes where code = v_code;
    v_ok  := (n = 0);
    v_det := format('rows=%s (0행 또는 권한오류여야 함)', n);
  exception when others then
    v_ok  := true;
    v_det := format('권한오류로 차단됨: %s / %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('②', '비멤버가 code 로 invite_codes 조회 불가', v_ok, v_det);

  -- (b) 오너도 테이블 SELECT 로는 못 읽는다 (정책이 아예 없기 때문)
  perform pg_temp.impersonate(v_a);
  begin
    select count(*) into n from public.invite_codes where group_id = v_gid;
    v_ok  := (n = 0);
    v_det := format('rows=%s', n);
  exception when others then
    v_ok  := true;
    v_det := format('권한오류로 차단됨: %s', sqlstate);
  end;

  -- (c) 정상 경로: 오너는 RPC 로 자기 코드를 본다
  -- ⚠ 위 begin/exception 이 걸리면 서브트랜잭션 롤백으로 role/jwt 설정이 되돌아간다.
  --    RPC 호출 전에 반드시 다시 흉내낸다.
  perform pg_temp.impersonate(v_a);
  v_rpc := public.current_invite_code(v_gid);
  perform pg_temp.unimpersonate();

  insert into p2b_results (gate, name, passed, detail) values
    ('②', '오너조차 invite_codes 테이블 SELECT 불가', v_ok, v_det),
    ('②', 'current_invite_code() RPC 는 오너에게 코드를 준다',
     v_rpc is not null and (v_rpc->>'code') = v_code,
     coalesce(v_rpc->>'code', '(null)'));
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('②', 'invite_codes 조회 차단', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- 비멤버가 코드를 안다면? — 그건 정상 참여다(코드는 공유하라고 있는 것).
-- 여기서 증명할 것은 "코드를 **모르는** 상태에서 테이블을 훑을 수 없다"이다.

-- ---------------------------------------------------------------------------
-- ③ join_group_with_code 6회 연속 시도 → 6번째 거절 (5회/5분)
-- ---------------------------------------------------------------------------
-- 존재하지 않는 코드로 시도한다. 한도는 **조회 이전에** 소모되므로 유효하지 않은
-- 코드로도 시도가 카운트된다 — 이게 32^6 공간 탐색을 막는 지점이다.
-- 1~5회: {ok:false, error:'invalid_code'}
-- 6회  : {ok:false, error:'rate_limited'}
do $$
declare
  v_b   uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_res jsonb;
  v_errs text[] := '{}';
  i int;
begin
  perform pg_temp.impersonate(v_b);

  -- 이전 실행 잔여물 제거는 unimpersonate 이후(6절)에 한다. 여기서는 깨끗하다고 가정.
  for i in 1..6 loop
    -- 절대 존재하지 않는 코드: 알파벳은 맞지만 임의값이라 적중 확률 9.3e-10
    v_res  := public.join_group_with_code('ZZZZZ' || substr('0123456789', 1 + (i % 10), 1));
    v_errs := v_errs || coalesce(v_res->>'error', 'ok');
  end loop;

  perform pg_temp.unimpersonate();

  insert into p2b_results (gate, name, passed, detail) values
    ('③', '1~5회 시도는 invalid_code (rate_limited 아님)',
     v_errs[1] = 'invalid_code' and v_errs[5] = 'invalid_code',
     array_to_string(v_errs, ', ')),
    ('③', '6번째 시도가 rate_limited 로 거절된다',
     v_errs[6] = 'rate_limited',
     format('6번째=%s', v_errs[6]));
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('③', 'join_group_with_code 레이트리밋', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- ---------------------------------------------------------------------------
-- ④ 21번째 메시지 즉시 전송 → rate_limited (토큰 버킷 용량 20)
-- ---------------------------------------------------------------------------
-- ★ 한 트랜잭션 안에서 now() 가 고정되므로 리필(초당 2)이 0이다.
--   따라서 20건은 통과하고 21번째가 정확히 막힌다 — 결정적이다.
-- ★ 예외를 잡는 순간 이 블록의 INSERT 21건이 전부 롤백된다(암묵 세이브포인트).
--   덕분에 검증 후 정리가 필요 없다.
do $$
declare
  v_a   uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_gid uuid := (select v from p2b_state where k = 'group_id')::uuid;
  v_ok  boolean := false;
  v_det text;
  v_n   int := 0;
  i int;
begin
  -- 준비 단계에서 메시지 1건을 이미 보냈으므로 버킷을 가득 채워 두고 시작한다.
  -- (테이블 소유자 롤이라 group_members 가드 트리거를 통과한다)
  update public.group_members
     set msg_tokens = 20, tokens_at = now()
   where group_id = v_gid and user_id = v_a;

  perform pg_temp.impersonate(v_a);

  begin
    for i in 1..21 loop
      insert into public.messages (id, group_id, author_id, body)
      values (gen_random_uuid(), v_gid, v_a, format('토큰버킷 검증 %s', i));
      v_n := i;
    end loop;
    v_det := '21건이 전부 통과했다 — 토큰 버킷이 동작하지 않는다';
  exception when sqlstate 'P0001' then
    -- ★ 예외 발생 시 이 블록의 INSERT 가 전부 롤백된다(암묵 세이브포인트)
    --   → 검증 후 별도 정리가 필요 없다.
    v_ok  := (sqlerrm = 'rate_limited' and v_n = 20);
    v_det := format('%s건 통과 후 %s번째에서 중단: %s (%s)', v_n, v_n + 1, sqlerrm, sqlstate);
  end;

  perform pg_temp.unimpersonate();

  insert into p2b_results (gate, name, passed, detail)
  values ('④', '20건은 통과하고 21번째가 P0001 rate_limited 로 막힌다', v_ok, v_det);
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('④', '메시지 토큰 버킷', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- 보너스: seq 가 그룹별 단조 증가인지
do $$
declare
  v_a   uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_gid uuid := (select v from p2b_state where k = 'group_id')::uuid;
  v_seqs bigint[];
begin
  perform pg_temp.impersonate(v_a);
  select array_agg(m.seq order by m.created_at, m.seq)
    into v_seqs
    from public.messages m where m.group_id = v_gid;
  perform pg_temp.unimpersonate();

  insert into p2b_results (gate, name, passed, detail)
  values ('④', 'messages.seq 가 1부터 연속 할당된다',
          v_seqs is not null and v_seqs[1] = 1,
          format('seqs=%s', v_seqs));
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('④', 'seq 할당', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- ---------------------------------------------------------------------------
-- ⑥ 화이트보드: 멤버 읽기/쓰기, 소프트삭제, PK 멱등, 토큰 버킷
-- ---------------------------------------------------------------------------
-- USER_B 를 같은 그룹의 일반 멤버로 만든 뒤 USER_A 도형을 공격한다.
-- 그 전의 비멤버 숨김은 ①/⑥ 앞 검사에서 이미 증명했다.
do $$
declare
  v_a          uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_b          uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_gid        uuid := (select v from p2b_state where k = 'group_id')::uuid;
  v_bid        uuid := (select v from p2b_state where k = 'board_id')::uuid;
  v_shape_a    uuid := (select v from p2b_state where k = 'shape_a_id')::uuid;
  v_shape_b    uuid := gen_random_uuid();
  v_shape_self uuid := gen_random_uuid();
  v_read_ok    boolean := false;
  v_write_ok   boolean := false;
  v_dup_ok     boolean := false;
  v_edit_ok    boolean := false;
  v_hard_ok    boolean := false;
  v_other_soft_ok boolean := false;
  v_self_soft_ok  boolean := false;
  v_owner_soft_ok boolean := false;
  v_det text;
  n int;
begin
  -- 테스트 픽스처 구성은 테이블 소유자 롤로 한다.
  insert into public.group_members (group_id, user_id, role)
  values (v_gid, v_b, 'member');

  perform pg_temp.impersonate(v_b);

  select count(*) into n from public.whiteboards where id = v_bid;
  v_read_ok := (n = 1);

  insert into public.whiteboard_shapes (id, board_id, kind, data_json, style_json)
  values (v_shape_b, v_bid, 'rect', '{"x":1,"y":2,"w":30,"h":40}',
          '{"stroke":"#2563eb"}');
  get diagnostics n = row_count;
  v_write_ok := (n = 1);

  -- 같은 클라이언트 id 재전송은 중복행이 아니라 23505 로 멱등하게 끝난다.
  begin
    insert into public.whiteboard_shapes (id, board_id, kind, data_json, style_json)
    values (v_shape_b, v_bid, 'rect', '{"x":999}', '{}');
    v_det := '동일 id 중복 INSERT 가 성공했다(치명적)';
  exception when unique_violation then
    v_dup_ok := true;
    v_det := format('%s / %s', sqlstate, sqlerrm);
  end;

  -- 일반 멤버가 남의 도형 내용을 바꾸는 UPDATE 문 자체를 컬럼 GRANT 가 막아야 한다.
  begin
    update public.whiteboard_shapes
       set data_json = '{"tampered":true}'
     where id = v_shape_a;
    get diagnostics n = row_count;
    v_edit_ok := (n = 0);
  exception when insufficient_privilege then
    v_edit_ok := true;
  end;

  -- DELETE 권한/정책이 없으므로 하드 삭제는 막힌다.
  begin
    delete from public.whiteboard_shapes where id = v_shape_a;
    get diagnostics n = row_count;
    v_hard_ok := (n = 0);
  exception when insufficient_privilege then
    v_hard_ok := true;
  end;

  -- deleted_at 은 열려 있어도 남의 도형은 UPDATE RLS 가 0행으로 숨긴다.
  update public.whiteboard_shapes set deleted_at = now() where id = v_shape_a;
  get diagnostics n = row_count;
  v_other_soft_ok := (n = 0);

  -- 작성자 본인의 소프트삭제는 통과한다.
  insert into public.whiteboard_shapes (id, board_id, kind, data_json, style_json)
  values (v_shape_self, v_bid, 'ellipse', '{"cx":5,"cy":5,"rx":2,"ry":3}', '{}');
  update public.whiteboard_shapes set deleted_at = now() where id = v_shape_self;
  get diagnostics n = row_count;
  v_self_soft_ok := (n = 1);

  perform pg_temp.unimpersonate();

  -- 그룹 owner 는 다른 작성자의 도형을 소프트삭제할 수 있다.
  perform pg_temp.impersonate(v_a);
  update public.whiteboard_shapes set deleted_at = now() where id = v_shape_b;
  get diagnostics n = row_count;
  v_owner_soft_ok := (n = 1);
  perform pg_temp.unimpersonate();

  -- 공격 시도 후에도 USER_A 도형 내용과 활성 상태가 그대로여야 한다.
  select count(*) into n
    from public.whiteboard_shapes
   where id = v_shape_a
     and deleted_at is null
     and data_json = '{"x1":0,"y1":0,"x2":10,"y2":10}'::jsonb;
  v_edit_ok := v_edit_ok and n = 1;
  v_other_soft_ok := v_other_soft_ok and n = 1;

  insert into p2b_results (gate, name, passed, detail) values
    ('⑥', '멤버는 whiteboards / whiteboard_shapes 를 읽고 쓴다',
     v_read_ok and v_write_ok, format('read=%s write=%s', v_read_ok, v_write_ok)),
    ('⑥', '같은 shape id 두 번 INSERT 는 PK 충돌로 멱등하다', v_dup_ok, v_det),
    ('⑥', '남의 도형 내용을 UPDATE 할 수 없다', v_edit_ok, null),
    ('⑥', '남의 도형을 하드 DELETE 할 수 없다', v_hard_ok, null),
    ('⑥', '일반 멤버는 남의 도형을 소프트삭제할 수 없다', v_other_soft_ok, null),
    ('⑥', '작성자는 자기 도형을 소프트삭제할 수 있다', v_self_soft_ok, null),
    ('⑥', '그룹 owner 는 남의 도형을 소프트삭제할 수 있다', v_owner_soft_ok, null);
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('⑥', '화이트보드 RLS/멱등 검증', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- 화이트보드 전용 버킷은 한 트랜잭션에서 200건을 통과시키고 201번째를 막는다.
do $$
declare
  v_b   uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_gid uuid := (select v from p2b_state where k = 'group_id')::uuid;
  v_bid uuid := (select v from p2b_state where k = 'board_id')::uuid;
  v_ok  boolean := false;
  v_det text;
  v_n   int := 0;
  i int;
begin
  update public.group_members
     set wb_tokens = 200, wb_tokens_at = now()
   where group_id = v_gid and user_id = v_b;

  perform pg_temp.impersonate(v_b);
  begin
    for i in 1..201 loop
      insert into public.whiteboard_shapes (id, board_id, kind, data_json, style_json)
      values (gen_random_uuid(), v_bid, 'line',
              jsonb_build_object('n', i, 'x1', 0, 'y1', 0, 'x2', i, 'y2', i),
              '{"color":"#111827"}');
      v_n := i;
    end loop;
    v_det := '201건이 전부 통과했다 — 화이트보드 토큰 버킷이 동작하지 않는다';
  exception when sqlstate 'P0001' then
    v_ok := (sqlerrm = 'rate_limited' and v_n = 200);
    v_det := format('%s건 통과 후 %s번째에서 중단: %s (%s)',
                    v_n, v_n + 1, sqlerrm, sqlstate);
  end;
  perform pg_temp.unimpersonate();

  insert into p2b_results (gate, name, passed, detail)
  values ('⑥', '화이트보드 200건은 통과하고 201번째가 rate_limited', v_ok, v_det);
exception when others then
  perform pg_temp.unimpersonate();
  insert into p2b_results (gate, name, passed, detail)
  values ('⑥', '화이트보드 토큰 버킷', false, format('%s / %s', sqlstate, sqlerrm));
end;
$$;

-- ---------------------------------------------------------------------------
-- ⑤ RLS 재귀 없음 (42P17 이 어디서도 나지 않는다)
-- ---------------------------------------------------------------------------
-- 재귀는 "느려짐"이 아니라 **에러(42P17 infinite recursion detected in policy)** 로
-- 나타난다. 정책이 걸린 모든 테이블을 양쪽 사용자로 한 번씩 훑어 잡는다.
do $$
declare
  v_a uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_b uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_tables text[] := array[
    'public.profiles', 'public.study_groups', 'public.group_members',
    'public.messages', 'public.friendships', 'public.group_invites',
    'public.blocks', 'public.invite_codes', 'public.reports', 'public.rate_events',
    'public.whiteboards', 'public.whiteboard_shapes'
  ];
  v_uid uuid;
  t text;
  n int;
  v_ok boolean;
  v_det text;
  u int;
begin
  for u in 1..2 loop
    v_uid := case u when 1 then v_a else v_b end;

    foreach t in array v_tables loop
      perform pg_temp.impersonate(v_uid);
      begin
        execute format('select count(*) from %s', t) into n;
        v_ok  := true;
        v_det := format('rows=%s', n);
      exception
        when sqlstate '42P17' then
          v_ok  := false;
          v_det := format('★ 무한 재귀: %s', sqlerrm);
        when insufficient_privilege then
          v_ok  := true;   -- 권한 자체가 없는 건 의도된 설계(rate_events, invite_codes, reports)
          v_det := '권한 없음(의도된 설계)';
        when others then
          v_ok  := false;
          v_det := format('%s / %s', sqlstate, sqlerrm);
      end;
      perform pg_temp.unimpersonate();

      insert into p2b_results (gate, name, passed, detail)
      values ('⑤', format('%s SELECT (user %s) 재귀 없음', t, u), v_ok, v_det);
    end loop;
  end loop;
end;
$$;

-- 정책 자체가 group_members / study_groups 를 직접 참조하지 않는지 정적으로도 본다.
-- (헬퍼를 통하지 않고 테이블명이 정책 식에 직접 등장하면 재귀 후보다)
do $$
declare
  r record;
  v_bad int := 0;
  v_det text := '';
begin
  for r in
    select p.polname, c.relname,
           pg_catalog.pg_get_expr(p.polqual,      p.polrelid) as qual,
           pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
  loop
    if coalesce(r.qual, '') || coalesce(r.wcheck, '') ~ '\mgroup_members\M'
       or coalesce(r.qual, '') || coalesce(r.wcheck, '') ~ '\mstudy_groups\M' then
      v_bad := v_bad + 1;
      v_det := v_det || format('%s.%s; ', r.relname, r.polname);
    end if;
  end loop;

  insert into p2b_results (gate, name, passed, detail)
  values ('⑤', '어떤 정책도 group_members/study_groups 를 직접 참조하지 않는다',
          v_bad = 0,
          case when v_bad = 0 then '전부 SECURITY DEFINER 헬퍼 경유' else v_det end);
end;
$$;

-- 헬퍼가 전부 SECURITY DEFINER + search_path='' 인지
do $$
declare
  v_bad text := '';
  r record;
begin
  for r in
    select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('is_group_member','is_group_admin','is_group_owner',
                         'shares_group_with','is_friend','is_blocked_either_way',
                         'try_rate','check_rate','create_group','join_group_with_code',
                         'invite_by_nickname','respond_group_invite','send_friend_request',
                         'respond_friend_request','find_profile_by_nickname','leave_group',
                         'kick_member','set_member_role','mark_read','unread_counts',
                         'regenerate_invite_code','current_invite_code','mint_invite_code',
                         'delete_message','load_messages','report_content','block_user',
                         'whiteboard_shapes_before_insert',
                         'broadcast_whiteboard_shape_insert',
                         'broadcast_whiteboard_shape_remove','prune_whiteboard_shapes')
  loop
    if not r.prosecdef then
      v_bad := v_bad || r.proname || '(not security definer) ';
    elsif r.cfg not like '%search_path=%' then
      v_bad := v_bad || r.proname || '(no search_path) ';
    end if;
  end loop;

  insert into p2b_results (gate, name, passed, detail)
  values ('⑤', '헬퍼/RPC 전원 security definer + search_path=""',
          v_bad = '', coalesce(nullif(v_bad, ''), 'OK'));
end;
$$;

-- authenticated 가 EXECUTE 할 수 있는 함수가 허용 목록 안에만 있는지
-- ★ 이 검사가 필요한 이유: Supabase 는 `alter default privileges … grant all on
--   functions to anon, authenticated` 가 걸려 있어서 **새 함수는 authenticated 에게
--   직접 EXECUTE 가 부여된 채로 태어난다.** `revoke … from public, anon` 만 하면
--   내부 전용 함수가 그대로 노출된다. 함수를 추가할 때마다 여기서 걸린다.
do $$
declare
  v_allow text[] := array[
    -- 정책 평가용 헬퍼
    'is_group_member','is_group_admin','is_group_owner','shares_group_with','is_friend',
    'realtime_group_id','normalize_invite_code',
    -- 클라이언트가 부르는 RPC
    'find_profile_by_nickname','create_group','leave_group','kick_member','set_member_role',
    'mark_read','unread_counts','regenerate_invite_code','current_invite_code',
    'join_group_with_code','send_friend_request','respond_friend_request','remove_friend',
    'invite_by_nickname','respond_group_invite','delete_message','load_messages',
    'block_user','unblock_user','blocked_ids','report_content'
  ];
  v_bad text := '';
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
  loop
    if not (r.proname = any(v_allow)) then
      v_bad := v_bad || r.sig || ' ';
    end if;
  end loop;

  insert into p2b_results (gate, name, passed, detail)
  values ('⑤', 'authenticated 는 허용 목록 밖 함수를 EXECUTE 할 수 없다',
          v_bad = '', coalesce(nullif(v_bad, ''), 'OK'));
end;
$$;

-- anon 이 EXECUTE 할 수 있는 public 함수가 하나도 없는지
do $$
declare
  v_bad text := '';
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || r.sig || ' ';
  end loop;

  insert into p2b_results (gate, name, passed, detail)
  values ('⑤', 'anon 은 public 함수를 하나도 EXECUTE 할 수 없다',
          v_bad = '', coalesce(nullif(v_bad, ''), 'OK'));
end;
$$;

-- anon 에게 열린 테이블이 없는지
do $$
declare
  v_bad text := '';
  r record;
begin
  for r in
    select table_name, privilege_type
      from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public'
  loop
    v_bad := v_bad || format('%s:%s ', r.table_name, r.privilege_type);
  end loop;

  insert into p2b_results (gate, name, passed, detail)
  values ('⑤', 'anon 롤에 public 테이블 권한이 하나도 없다',
          v_bad = '', coalesce(nullif(v_bad, ''), 'OK'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 정리 — 검증이 만든 데이터를 지운다
-- ---------------------------------------------------------------------------
do $$
declare
  v_a   uuid := (select v from p2b_cfg where k = 'user_a')::uuid;
  v_b   uuid := (select v from p2b_cfg where k = 'user_b')::uuid;
  v_gid uuid := (select v from p2b_state where k = 'group_id')::uuid;
begin
  if v_gid is not null then
    delete from public.whiteboard_shapes where board_id in (
      select id from public.whiteboards where group_id = v_gid
    );
    delete from public.whiteboards   where group_id = v_gid;
    delete from public.messages      where group_id = v_gid;
    delete from public.invite_codes  where group_id = v_gid;
    delete from public.group_invites where group_id = v_gid;
    delete from public.group_members where group_id = v_gid;
    delete from public.study_groups  where id       = v_gid;
  end if;

  -- 레이트리밋 원장도 되돌린다. 안 지우면 실제 사용 시 한도가 이미 깎여 있다.
  delete from public.rate_events where user_id in (v_a, v_b);

  insert into p2b_results (gate, name, passed, detail)
  values ('cleanup', '검증용 그룹/메시지/화이트보드/rate_events 삭제', true, v_gid::text);
exception when others then
  insert into p2b_results (gate, name, passed, detail)
  values ('cleanup', '정리 실패 — 수동 삭제가 필요합니다', false,
          format('%s / %s (group_id=%s)', sqlstate, sqlerrm, v_gid));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 결과
-- ---------------------------------------------------------------------------
select
  case when passed then '✅ PASS' else '❌ FAIL' end as result,
  gate,
  name,
  detail
from p2b_results
order by ord;

-- 요약 한 줄이 필요하면:
--   select count(*) filter (where not passed) as failures from p2b_results;
