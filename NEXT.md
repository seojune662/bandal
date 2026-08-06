# 다음에 이어서 할 일

마지막 커밋: `c1ed6b0 feat: OAuth 딥링크 연결 — Phase 2 인증 완성`
작성 시점: 2026-08-06 (재부팅 직전)

---

## 재부팅 후 첫 명령

```bash
cd ~/Desktop/bandal
claude --continue          # 이전 세션 이어가기
```

## 1. 빌드가 살아났는지 먼저 확인 (2분)

재부팅 전까지 이 머신에서는 스왑 포화로 `pnpm build`가 데드락이었다.
디스크는 15GB 로 회복됐으니 재부팅 후 아래가 통과하면 정상이다.

```bash
pnpm typecheck        # 정상이면 ~15초
pnpm build            # 이게 끝까지 가면 빌드 데드락 해소
```

`pnpm typecheck` 이 5분 넘게 걸리면 디스크/스왑이 아직 문제다.
`df -h /` 와 활동 모니터의 스왑 사용량을 먼저 보라.

## 2. 아직 아무도 앱을 실행해본 적이 없다 ⚠️

타입·테스트·대비는 전부 통과했지만 **실제 실행 검증은 0회**다. 순서대로:

```bash
pnpm dev
```

- [ ] 창이 뜨는가 (안 뜨면 `startupError.ts` 다이얼로그가 원인을 알려준다)
- [ ] 과목 추가 → 폴더 선택 → 우측에 파일 트리
- [ ] 탭 6종 각각 열기 (pdf / note / browser / chat / board / group-chat)
- [ ] **함께하기 → 로그인 → 그룹 생성 → 초대코드 → 다른 계정으로 참여 → 메시지 3초 내 도착**

마지막 항목이 핵심이다. 실시간 채팅은 **실패해도 에러 없이 조용히 안 오는** 종류라
스텁 테스트로 대체가 불가능하다. 안 오면 의심 순서:
1. `realtime.setAuth()` 호출 누락
2. private 채널 설정
3. 0008 마이그레이션의 realtime 정책 (적용 확인은 끝났으니 아닐 가능성 높음)

### 개발 모드 딥링크 함정
macOS 는 URL 스킴을 **번들**에 연결한다. `pnpm dev` 에서는 `Electron.app` 이
`bandal://` 의 주인이 된다. 딥링크가 무반응이면 코드 버그가 아니라 스킴 미등록이다.
`pnpm dist` 로 만든 앱을 한 번 실행해 등록시킨 뒤 다시 시도. 상세: `docs/oauth-setup.md` §6

## 3. 남은 백로그

| # | 항목 | 메모 |
|---|------|------|
| 23 | dmg 경량화 | 앱 본체 4MB 인데 dmg 148MB. asar 에 테스트 전용 `canvas` 18MB, `vue` 8.7MB, `@babel` 이 섞여 들어간다. `electron-builder.yml` 에 `files` 화이트리스트 필요 (better-sqlite3, chokidar 만 있으면 된다) |
| 23 | `will-download` 핸들러 | 브라우저가 강의자료를 받으면 `~/Downloads` 로 간다. 과목 폴더로 떨어져야 한다. `src/` 에 "download" 문자열이 0회 = 핸들러 자체가 없음 |
| 24 | `menu.ts` 의 `role: 'editMenu'` | 커스텀 undo/redo 로 교체 |
| 24 | `Read`/`WebFetch` 전면 허용 | 범위 제한 검토 |
| 24 | "항상 허용" 이 도구 이름 단위 | 학생이 `Write` 를 다시 넓힐 수 있다 |
| — | pg_cron | 대시보드 Database → Extensions 토글 후: `select cron.schedule('bandal-retention','15 3 * * 0',$j$ select public.run_retention(); $j$);` |
| — | 앱 서명/공증 | 지금 adhoc → Gatekeeper 가 다운로드를 막는다. 배포하려면 Developer ID 필요 |
| — | `supabase/tests/rls_verification.sql` | 38행 게이트. 실제 계정 uuid 2개를 넣어야 돌아간다 |

## 4. 이 환경의 지뢰 (docs/environment-issues.md 요약)

- `codex exec` 는 반드시 `< /dev/null` — 없으면 stdin EOF 를 무한 대기하며 행이 걸린다
- 에이전트 병렬도 **1**. 여럿이 tsc/vitest 를 동시에 돌리면 tsc 가 14초 → 52분이 된다
- `pnpm store prune` 금지 — 800MB 벌고 다음 install 에서 679패키지를 다시 받는다
- git 이 멈추면 iCloud 때문이다. plumbing 커밋으로 우회:
  `git add` → `git write-tree` → `git commit-tree` → `git update-ref`

## 5. 별도 저장소

웹사이트는 `~/Desktop/bandal-web/` (Astro, 커밋 `f77a4ca`). 앱의
`dark-navy.css` / `light.css` 를 그대로 import 하므로 테마를 고치면 양쪽을 함께 본다.
다운로드 URL 은 `src/consts.ts` 에 플레이스홀더로 모여 있다 — 서명·배포 후 채운다.
