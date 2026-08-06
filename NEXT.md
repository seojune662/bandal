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

## 2. 실행 검증 — 절반 끝났다 ⚠️ ← 여기부터

**패키징된 앱은 실행된다** (2026-08-06). 공증된 v0.1.0 dmg 를 마운트해 띄웠고
창이 뜨고 SQLite 마이그레이션 5개가 적용됐다. 하드닝된 런타임에서 네이티브
바인딩이 로드되는 것까지 확인했다 — entitlements 가 맞다는 뜻이다.

**하지만 UI 를 손으로 눌러본 적은 없다.** 아래는 여전히 미검증이다:

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

**v0.1.0 이 실제로 배포됐다** (2026-08-06):
https://github.com/seojune662/bandal/releases/tag/v0.1.0

- macOS arm64·x64 (서명 + Apple 공증 완료 — `spctl` 이 `Notarized Developer ID` 로 판정)
- Windows x64 NSIS (미서명, SmartScreen 경고 1회)
- `latest-mac.yml` / `latest.yml` 둘 다 첨부 = 자동 업데이트 피드 정상
- 시크릿 8개 등록 완료, 웹사이트 다운로드 링크 3개 모두 200

첫 릴리스에서 파이프라인 버그 3개를 잡았고 전부 고쳐져 있다:
1. 워크플로에 `electron-vite build` 가 빠져 asar 가 비어 있었다
2. 이름이 같은 Developer ID 인증서가 두 장이라 codesign 이 ambiguous 로 죽었다
   (해시 지정으로는 안 고쳐진다 — electron-builder 가 codesign 에는 이름을 넘긴다)
3. 태그와 package.json version 은 정확히 같아야 한다 (`v0.1.0-rc.1` 은 막힌다)

### 다음 릴리스에서 반드시 할 것

**자동 업데이트는 아직 진짜로 검증되지 않았다.** 버전이 하나뿐이라 확인할 수가
없다. `v0.1.1` 을 내고 나서 0.1.0 설치본으로 아래를 돌려야 완료다:

1. v0.1.0 설치 → 실행
2. v0.1.1 릴리스
3. 설정 → About → 업데이트 확인
4. 토스트 → 퍼센트 → 재시작 후 **버전이 0.1.1 인가**

mac·Windows 양쪽에서. Squirrel.Mac 과 NSIS 는 다른 구현이라 한쪽 성공이 다른
쪽을 보장하지 않는다. 상세는 `docs/release.md` §6.

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
다운로드 URL 은 `src/consts.ts` 에 모여 있고 **v0.1.0 릴리스로 채워져 있다**
(`hasPublishedRelease: true`, mac arm64/x64 + Windows 링크 3개 모두 200 확인).
파일명에 버전이 없으므로 다음 릴리스에도 그대로 유효하다 — 단
`electron-builder.yml` 의 `artifactName` 을 바꾸면 같이 깨진다.
**이 변경은 아직 커밋되지 않았다** (그 리포에 다른 미커밋 작업이 섞여 있다).
