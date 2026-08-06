# 다음에 이어서 할 일

마지막 커밋: `88c86f9 docs: 재부팅 후 이어갈 작업 노트`
갱신: 2026-08-06 (리포 이동 후)

> **리포 경로가 바뀌었다: `~/dev/bandal`**
> `~/Desktop/bandal` 은 없다. iCloud 동기화 폴더를 벗어나려고 옮겼다 — `docs/environment-issues.md` §1.

## 첫 명령

```bash
cd ~/dev/bandal
claude --continue
```

## 1. 빌드 검증 — ✅ 끝났다 (2026-08-06)

| | 옛 위치(`~/Desktop`) | 새 위치(`~/dev`) |
|---|---|---|
| `pnpm typecheck` | 19분 47초 | **1.55초** |
| `pnpm build` | 15분 00초 | **2.75초** |
| `pnpm test` | — | **2.36초** (673 passed / 1 skipped) |
| `pnpm install` | — | 19초 (네이티브 리빌드 포함) |

재부팅 전의 빌드 데드락은 해소됐고, 느림의 원인이 디스크가 아니라 **iCloud eviction** 이었음이
실측으로 확인됐다(typecheck CPU 4.6초 / 벽시계 19분 47초). 이제 이 항목은 다시 볼 필요 없다.

## 2. 아직 아무도 앱을 실행해본 적이 없다 ⚠️ ← 여기부터

타입·테스트·빌드는 전부 통과했지만 **실제 실행 검증은 0회**다. 순서대로:

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

## 배포 — ✅ 구축 완료 (2026-08-06)

mac·Windows 자동 빌드 + 앱 내 자동 업데이트가 붙었다. 전체 설명은
**`docs/release.md`** 에 있다. 요약:

- 태그(`v0.2.0`) 를 밀면 Actions 가 양 플랫폼을 빌드하고, mac 은 서명·공증까지 한다
- dmg 148MB → **95MB** (남은 대부분은 Electron 프레임워크 자체라 더 못 줄인다)
- Windows 포팅 완료: `/bin/zsh` 하드코딩 제거, `.cmd` 실행, `taskkill` 트리 종료, `icon.ico`
- 앱이 6시간마다 새 버전을 확인하고 토스트로 알린다 (설정 → About 에서 수동 확인)

**아직 남은 사람 몫** (`docs/release.md` §3):

1. `seojune662/bandal` 에 소스 푸시 + **public 전환** (지금 커밋 0개)
2. GitHub 시크릿 8개 등록 — 없으면 미서명으로 나가거나 "함께하기" 가 사라진다
3. 첫 태그를 밀어 파이프라인 확인 — 실패해도 릴리스는 draft 로 남는다
4. 두 버전으로 자동 업데이트 **실제 검증** (mac·Windows 각각)

⚠ x64 빌드를 돌린 뒤에는 `pnpm postinstall` 로 네이티브 모듈을 arm64 로 되돌려야
`pnpm dev` / `pnpm e2e` 가 다시 돈다 — `docs/release.md` §7.

## 3. 남은 백로그

| # | 항목 | 메모 |
|---|------|------|
| 23 | `will-download` 핸들러 | 브라우저가 강의자료를 받으면 `~/Downloads` 로 간다. 과목 폴더로 떨어져야 한다. `src/` 에 "download" 문자열이 0회 = 핸들러 자체가 없음 |
| 24 | `menu.ts` 의 `role: 'editMenu'` | 커스텀 undo/redo 로 교체 |
| 24 | `Read`/`WebFetch` 전면 허용 | 범위 제한 검토 |
| 24 | "항상 허용" 이 도구 이름 단위 | 학생이 `Write` 를 다시 넓힐 수 있다 |
| ⬆ | **앱 데이터 루트가 iCloud 로 올라간다** | `~/Documents/Bandal` 이 동기화 대상. 우리가 겪은 eviction 을 사용자도 겪는다. 폴더 기반 과목 추가가 근본 해법 — `docs/environment-issues.md` §3 |
| — | pg_cron | 대시보드 Database → Extensions 토글 후: `select cron.schedule('bandal-retention','15 3 * * 0',$j$ select public.run_retention(); $j$);` |
| — | Windows 코드 서명 | 지금 미서명 → SmartScreen 경고. 자동 업데이트는 정상 동작한다. `docs/release.md` §8 |
| — | `supabase/tests/rls_verification.sql` | 38행 게이트. 실제 계정 uuid 2개를 넣어야 돌아간다 |
| — | `untitled.md` 의 OAuth client secret | gitignore 로 막아뒀지만 리포 밖으로 옮길 것 |

## 4. 이 환경의 지뢰

`docs/environment-issues.md` 를 보라. 요약:

- 작업 전 `ps -Ao pid,command | grep '[c]laude'` — 세션 3개가 동시에 돌며 충돌한 적이 있다
- `codex exec` 는 반드시 `< /dev/null`
- `pnpm store prune` 금지
- ~~git plumbing 우회~~, ~~에이전트 병렬도 1~~ — iCloud 를 벗어나며 둘 다 불필요해졌다

## 5. 별도 저장소

웹사이트는 `~/Desktop/bandal-web/` (Astro, 커밋 `f77a4ca`). **이쪽은 아직 iCloud 안에 있다** —
느리면 같은 이유이니 `~/dev/bandal-web` 으로 옮기면 된다.
앱의 `dark-navy.css` / `light.css` 를 그대로 import 하므로 테마를 고치면 양쪽을 함께 본다.
다운로드 URL 은 `src/consts.ts` 에 플레이스홀더로 모여 있다 — 서명·배포 후 채운다.
