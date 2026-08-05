-- ============================================================================
-- [C9] Bandal Phase 2 — 0009_cron_retention.sql   (§6.2)
--
-- 만드는 것:
--   * public.prune_messages()      — 그룹당 5,000건 초과 + 180일 초과 삭제
--   * public.prune_rate_events()   — 2일 초과분 삭제
--   * public.prune_invite_codes()  — 죽은 코드 정리
--   * public.run_retention()       — 위 셋을 한 번에 (pg_cron 이 이걸 부른다)
--   * pg_cron 스케줄 (있으면 등록, 없으면 NOTICE 만 남기고 넘어간다)
--
-- 의존: 0004(invite_codes), 0006(messages), 0007(rate_events)
--
-- ★ 왜 P2-E 가 아니라 지금인가(§8 위험 목록)
--   무료 티어의 병목은 동시접속이 아니라 **DB 500MB** 다. 행 200B + 인덱스 300B 로
--   약 80만 메시지 = 13,000건/일 기준 **약 60일**이면 포화한다. 보존 정책을 나중에
--   붙이면 "나중"이 오기 전에 프로젝트가 멈춘다. 그래서 P2-B 에 넣는다.
--
-- ⚠ 사용자 고지 필수: 그룹당 5,000건 / 180일 (§7.3-5 계정 소유자 승인 항목).
--   앱 안에 이 문구가 없으면 데이터가 조용히 사라진 것으로 보인다.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. 메시지 보존 (§6.2)
-- ---------------------------------------------------------------------------
-- 두 규칙을 **AND** 가 아니라 각각 적용한다:
--   (a) 그룹당 seq 내림차순 5,000건 밖은 삭제 — 활발한 그룹의 폭주 상한
--   (b) 180일 초과는 삭제 — 조용한 그룹의 장기 누적 상한
-- 삭제는 물리 삭제다. seq 는 재사용되지 않으므로(카운터가 study_groups 에 있음)
-- 갭 감지 로직은 영향받지 않는다 — 클라이언트는 "그 아래는 없음"으로 본다.
--
-- reply_to 자기참조 FK 때문에 오래된 메시지를 지울 때 최신 답장이 걸릴 수 있다.
-- 삭제 전에 매달린 reply_to 를 NULL 로 끊는다.
create or replace function public.prune_messages(
  p_keep_per_group int      default 5000,
  p_max_age        interval default interval '180 days',
  p_batch          int      default 20000
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int := 0;
  v_ids     uuid[];
begin
  select coalesce(array_agg(s.id), '{}'::uuid[])
    into v_ids
    from (
      select m.id
        from (
          select m2.id,
                 m2.created_at,
                 row_number() over (partition by m2.group_id order by m2.seq desc) as rn
            from public.messages m2
        ) m
       where m.rn > p_keep_per_group
          or m.created_at < now() - p_max_age
       limit p_batch
    ) s;

  if array_length(v_ids, 1) is null then
    return 0;
  end if;

  -- 삭제될 메시지를 가리키는 답장 링크를 먼저 끊는다
  update public.messages set reply_to = null where reply_to = any(v_ids);

  delete from public.messages where id = any(v_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_messages(int, interval, int) is
  '§6.2 그룹당 5,000건 + 180일 보존. 배치 상한이 있으므로 초기 정리는 여러 번 돌 수 있다.';

-- ---------------------------------------------------------------------------
-- 2. rate_events 정리 (§2.9 "pg_cron 일 1회 2일 초과분 삭제")
-- ---------------------------------------------------------------------------
create or replace function public.prune_rate_events(p_max_age interval default interval '2 days')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted int;
begin
  delete from public.rate_events where created_at < now() - p_max_age;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 만료 초대 코드 정리
-- ---------------------------------------------------------------------------
-- 살아있는 코드는 건드리지 않는다. revoke 됐거나 만료된 지 30일 지난 것만 지운다.
-- (바로 지우지 않는 이유: "코드 만료됐어?" 문의가 들어왔을 때 확인 여지를 남긴다)
create or replace function public.prune_invite_codes(p_grace interval default interval '30 days')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted int;
begin
  delete from public.invite_codes
   where (revoked_at is not null and revoked_at < now() - p_grace)
      or (revoked_at is null     and expires_at < now() - p_grace);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- 만료됐지만 revoke 되지 않은 코드에 revoked_at 을 찍어 둔다.
-- 부분 유니크 인덱스(group_id where revoked_at is null)가 만료 코드에 잡혀 있으면
-- 새 코드 발급이 막힐 수 있는데, mint_invite_code 가 항상 먼저 revoke 하므로
-- 실제로 막히지는 않는다. 이건 위생 작업이다.
create or replace function public.revoke_expired_invite_codes()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated int;
begin
  update public.invite_codes
     set revoked_at = expires_at
   where revoked_at is null and expires_at < now();
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 한 번에 도는 진입점
-- ---------------------------------------------------------------------------
create or replace function public.run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msgs   int;
  v_rates  int;
  v_revoke int;
  v_codes  int;
begin
  v_msgs   := public.prune_messages();
  v_rates  := public.prune_rate_events();
  v_revoke := public.revoke_expired_invite_codes();
  v_codes  := public.prune_invite_codes();

  return jsonb_build_object(
    'messagesDeleted',   v_msgs,
    'rateEventsDeleted', v_rates,
    'codesRevoked',      v_revoke,
    'codesDeleted',      v_codes,
    'ranAt',             now()
  );
end;
$$;

comment on function public.run_retention() is
  '§6.2 보존 정책 일괄 실행. pg_cron 이 없으면 수동으로 select public.run_retention(); 하면 된다.';

-- ★ 보존 함수는 전부 관리 작업이다. 어떤 클라이언트 롤에도 EXECUTE 를 주지 않는다.
revoke execute on function public.prune_messages(int, interval, int)  from public, anon, authenticated;
revoke execute on function public.prune_rate_events(interval)         from public, anon, authenticated;
revoke execute on function public.prune_invite_codes(interval)        from public, anon, authenticated;
revoke execute on function public.revoke_expired_invite_codes()       from public, anon, authenticated;
revoke execute on function public.run_retention()                     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. pg_cron 스케줄 — 없으면 그냥 넘어간다
-- ---------------------------------------------------------------------------
-- ⚠ 이 블록은 **절대 마이그레이션을 실패시키지 않는다.**
--   pg_cron 은 프로젝트/플랜/데이터베이스에 따라 없을 수 있고, 그때 이 파일이
--   깨지면 스키마 전체 적용이 막힌다. 없으면 NOTICE 만 남기고 통과한다.
--   cron.* 참조는 전부 EXECUTE 동적 SQL 이다 — cron 스키마가 없어도 컴파일된다.
do $$
declare
  v_has_ext boolean;
begin
  select exists (select 1 from pg_available_extensions where name = 'pg_cron')
    into v_has_ext;

  if not v_has_ext then
    raise notice '[0009] pg_cron 을 쓸 수 없는 환경입니다. 스케줄을 건너뜁니다.';
    raise notice '[0009] ⚠ §6.2 병목은 DB 500MB 입니다. 외부 스케줄러(GitHub Actions 등)에서';
    raise notice '[0009]   주 1회  select public.run_retention();  를 반드시 돌리세요.';
    return;
  end if;

  begin
    execute 'create schema if not exists cron';
    execute 'create extension if not exists pg_cron with schema cron';
  exception when others then
    raise notice '[0009] pg_cron 활성화 실패(%): 대시보드 Database → Extensions 에서 켠 뒤 이 파일을 다시 실행하세요.', sqlerrm;
    return;
  end;

  -- 기존 잡 제거(재적용 멱등성)
  begin
    execute $q$ select cron.unschedule('bandal-retention') $q$;
  exception when others then
    null;   -- 처음 적용이면 잡이 없다
  end;

  begin
    -- 매주 일요일 03:15 UTC = 월요일 12:15 KST. 강의가 없는 시간대를 고른다.
    execute $q$
      select cron.schedule('bandal-retention', '15 3 * * 0',
                           $job$ select public.run_retention(); $job$)
    $q$;
    raise notice '[0009] pg_cron 잡 bandal-retention 을 등록했습니다 (매주 일 03:15 UTC).';
  exception when others then
    raise notice '[0009] cron.schedule 실패(%). 수동으로 등록하세요.', sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 적용 후 확인
-- ---------------------------------------------------------------------------
--   select * from cron.job where jobname = 'bandal-retention';
--   select public.run_retention();          -- 즉시 1회 수동 실행 (postgres 롤)
--   select * from cron.job_run_details order by start_time desc limit 5;

reset check_function_bodies;
