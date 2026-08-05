-- 20260806000010_enable_pg_cron.sql
--
-- 0009 적용 직후 확인해 보니 `cron` 스키마가 존재하지 않았다. 즉 보존 정책
-- 스케줄이 등록되지 않은 상태다. §6.2 기준 무료 티어의 병목은 동시 접속이 아니라
-- **DB 500MB** 이고, 하루 13,000건 페이스면 약 60일에 포화한다. 그래서 재시도한다.
--
-- 0009 의 DO 블록과 동일한 가드를 유지한다 — 확장을 켤 수 없는 환경이면
-- NOTICE 만 남기고 성공으로 끝난다(마이그레이션 전체를 실패시키지 않는다).
--
-- 의존: 0009 가 만든 public.run_retention()

do $$
declare
  v_has_ext boolean;
  v_scheduled boolean := false;
begin
  -- run_retention() 이 없으면 0009 가 제대로 안 올라간 것이므로 아무것도 하지 않는다.
  if to_regprocedure('public.run_retention()') is null then
    raise notice '[0010] public.run_retention() 이 없습니다. 0009 를 먼저 확인하세요.';
    return;
  end if;

  select exists (select 1 from pg_available_extensions where name = 'pg_cron')
    into v_has_ext;

  if not v_has_ext then
    raise notice '[0010] 이 인스턴스에서 pg_cron 을 사용할 수 없습니다.';
    raise notice '[0010] 대안: 외부 스케줄러에서 주 1회  select public.run_retention();  실행';
    return;
  end if;

  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice '[0010] pg_cron 활성화 실패(%). 대시보드 Database → Extensions 에서 켠 뒤', sqlerrm;
    raise notice '[0010]   select cron.schedule(''bandal-retention'', ''15 3 * * 0'', $j$ select public.run_retention(); $j$);';
    return;
  end;

  -- 재적용 멱등성: 기존 잡이 있으면 지운다.
  begin
    perform cron.unschedule('bandal-retention');
  exception when others then
    null;
  end;

  begin
    -- 매주 일요일 03:15 UTC = 월요일 12:15 KST (강의가 없는 시간대)
    perform cron.schedule('bandal-retention', '15 3 * * 0',
                          $job$ select public.run_retention(); $job$);
    v_scheduled := true;
  exception when others then
    raise notice '[0010] cron.schedule 실패(%).', sqlerrm;
  end;

  if v_scheduled then
    raise notice '[0010] bandal-retention 등록 완료 (매주 일 03:15 UTC).';
  end if;
end;
$$;
