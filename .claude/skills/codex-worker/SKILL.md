---
name: codex-worker
description: Codex CLI를 병렬 코딩 워커로 부리는 표준 절차. UI 컴포넌트/CSS 등 표면 작업을 Codex에 위임하고, 결과를 검수·수용하는 워크플로. 병렬 구현 작업을 시작할 때 로드한다.
---

# Codex Worker 운용 절차

Bandal은 파일 소유권 분할로 병렬 개발한다. 각 워커(Codex 프로세스 또는 Claude 서브에이전트)는 서로 겹치지 않는 디렉토리를 소유하고, `src/shared/**` 계약 파일은 오케스트레이터가 확정한 뒤 **읽기 전용**으로 취급한다.

## 1. 역할 분담 기준

| 작업 성격 | 담당 |
|-----------|------|
| UI 컴포넌트, CSS, 마크업, 독립 feature 폴더 구현 | **Codex 워커** |
| 공유 타입, IPC 계약, DB 스키마, 에이전트 어댑터 등 정합성 코어 | Claude 서브에이전트 |
| 계약 확정, 브리프 발행, diff 검수, 통합, 게이트 판정 | 오케스트레이터 (이 세션) |

## 2. Codex 호출 (검증된 형태 — codex-cli 0.146.0)

background Bash로 실행해 여러 개 동시 운용한다:

```bash
codex exec --json --skip-git-repo-check \
  -C /Users/iseojun/Desktop/bandal \
  -s workspace-write \
  -o /tmp/codex-out-<태스크명>.md \
  "$(cat <<'BRIEF'
<태스크 브리프>
BRIEF
)" < /dev/null
```

**⚠️ `< /dev/null` 필수**: 비-TTY stdin(파이프)에서 codex exec가 "Reading additional input from stdin..."으로 EOF를 무한 대기하며 행이 걸린다. 백그라운드 실행 시 반드시 stdin을 닫을 것.

- `--json`: JSONL 이벤트 스트림 (item.completed의 agent_message가 최종 보고)
- `-o <file>`: 최종 메시지를 파일로 — 완료 후 이 파일만 읽으면 됨 (JSONL 전체를 파싱하지 말 것)
- `-s workspace-write`: 쓰기는 `-C` 디렉토리 안으로 제한
- 이어서 작업시키려면: `codex exec resume <thread_id> --json ... "<수정 브리프>"` (thread.started 이벤트의 thread_id를 기록해둘 것)

## 3. 태스크 브리프 템플릿 (필수 구조)

```
## 목표
<한 문단. 무엇이 완성되면 끝인지>

## 소유 파일 (이 안에서만 생성/수정)
- src/renderer/src/features/<feature>/**

## 읽기 전용 계약 (수정 절대 금지)
- src/shared/** (특히 ipc/contract.ts, tabs.ts, types/*)
- src/renderer/src/styles/tokens.css — 스타일은 반드시 이 시맨틱 토큰만 사용, 색상 하드코딩 금지

## 컨텍스트
<관련 계약 타입 요약, 참고할 기존 파일 경로, 디자인 방향>

## 금지사항
- 소유 밖 파일 수정, 새 의존성 추가(명시된 것 외), 계약 타입 변경
- 파일당 800줄 초과, 색상/간격 하드코딩

## 완료 기준
- pnpm typecheck 통과 (전체)
- <기능별 확인 항목>
- 최종 보고: 생성/수정 파일 목록 + 남은 이슈
```

## 3.1 리서치 태스크 브리프의 필수 금지 조항

외부 사이트를 조사하는 태스크(서브에이전트든 Codex든)에는 반드시 다음을 명시한다:

> **금지: 포트 스캔(nmap 등), 취약점 스캐닝, 인증 우회 시도, 자동화된 대량 요청.**
> 허용은 일반 브라우저와 동일한 HTTPS GET / WebSearch / WebFetch뿐.
> 검증 불가한 정보는 추측하지 말고 "미확인"으로 표시할 것.

실제 사고: 대학 사이트 조사 중 하위 에이전트가 승인 없이 대학 IP에 TCP 포트 스캔 수행
(2026-08-05, `docs/university-sites.md` provenance 부록 기록). 무단 포트 스캔은 법적 문제가 될 수 있다.

## 4. 결과 수용 절차 (게이트)

1. 완료 알림 → `-o` 파일 읽고 보고 확인
2. `git status` + `git diff --stat`으로 소유권 침범 검사 — **소유 밖 파일을 건드렸으면 해당 변경 revert 후 수정 브리프 재발행**
3. `pnpm typecheck && pnpm build` 실행
4. 실패 시: 에러 로그를 그대로 담은 수정 브리프로 `codex exec resume <thread_id>` 재발행 (최대 2회, 그 이상이면 Claude 서브에이전트로 전환)
5. 통과 시: 마일스톤 게이트에서 커밋

## 5. 병렬 운용 규칙

- 동시 Codex 워커 수 제한 없음(머신 부하 고려 3~4개 권장). 단 **같은 파일을 두 워커가 만지는 일이 없도록** 브리프의 소유권을 겹치지 않게 발행
- shared 계약 변경이 필요해지면: 워커를 멈추지 말고 오케스트레이터가 계약을 수정 → 전 워커에 "계약 vN 변경 사항" 공지 브리프로 전파
- git 커밋은 오케스트레이터만 수행 (워커는 커밋 금지 — 브리프 금지사항에 포함할 것)
