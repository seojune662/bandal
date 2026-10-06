# 계정·플랫폼·플러그인 검토 — 2026-10-07

## 검토 방법과 범위

로그인/복원/로그아웃, 계정 설정, 업데이트 확인/다운로드/오류/재시도, 플러그인 권한·설치·HTTP 통신, 팩 실행/승인/저장, 마감 알림, OS 권한 표시, 피드백 개인정보 선택, 진단 파일, 학교 설정의 정상·실패·동시 요청 가설을 코드와 비동기 회귀 검사로 확인했다. 계정·플랫폼 main과 renderer store/settings entry point, plugin store/runtime/API/broker/catalog, study/pack runner/store, db/layout/background/settings persistence 경로를 읽었다.

이 문서는 검토한 가설과 확인한 수정의 기록이다. 모든 결함이 없어졌다는 증명이 아니며, 서버/SDK/Supabase/web-demo 상세 검토와 플러그인 실행 경계는 아래 추가 라운드에 기록했다. 현재 accountRuntime에는 사회 기능의 구독/메시지/공유 보드가 없으므로 과거 SQL의 초대/협업 기능을 현재 앱의 사용 가능한 UI처럼 취급하지 않았다.

## 수정한 문제

| 사용자 가설 / 재현 | 원인과 수정 | 회귀 검사 |
| --- | --- | --- |
| 로그아웃 뒤 늦은 세션 조회/OAuth 결과가 돌아와도 로그인되지 않아야 함 | 조회 및 코드 교환 시작 세대 검증, 로그아웃 시작 시 세션 무효화/구독 해제 | authLifecycle, authProfile |
| 브라우저에서 빠르게 인증을 끝내면 계속 로그인 완료로 보여야 함 | openExternal의 늦은 응답이 signed-in을 signing-in으로 덮지 않도록 세대 확인 | authLifecycle |
| 최초 계정 상태 조회 중 완료된 로그인 푸시가 사라지면 안 됨 | authStore와 AccountPanel이 조회 전에 구독하고 최신 푸시 이후 과거 응답을 무시 | authStore, accountAvatar |
| 다운로드 완료/진행 푸시가 이전 상태 응답 때문에 사라지면 안 됨 | updateStore 최초 조회·확인·다운로드 응답에 세대 확인 | updateStore |
| 업데이트 버튼을 누르면 즉시 진행 상태가 보여야 하며 연타/주기 체크가 겹치지 않아야 함 | 첫 progress 이벤트 전 downloading 0% 발행, checking 중 중복 확인 차단, 다운로드 네트워크 중단을 error로 보존, 자체 리스너 정리 | updater/runtime |
| 플러그인 HTTP 요청이 표준 redirect를 따르면서 다른 출처에 인증 정보를 넘기지 않아야 함 | 매 redirect 권한 재검사 유지, origin 변경 시 Authorization 제거, 301/302 POST 및 303을 GET으로 전환, 304·Location 없는 응답 그대로 반환 | pluginFetch |
| 실행 중 다른 팩 요청이 실패해도 기존 실행의 도구 제한을 유지해야 함 | 같은 과목 activeRun 중 새 실행 거절 | packRunner |
| 승인창이 설명한 팩만 승인되어야 함 | 확인 중 변경/삭제/비활성화된 팩을 재검증하여 실행과 영구 승인을 차단 | packRunner |
| 저장소 읽기 실패가 사용자 팩을 초기화하면 안 됨 | 파일 I/O 오류와 JSON/형식 손상을 분리하여 읽기 실패시 원본 보존 | packStore |
| 며칠 만에 앱을 열 때 같은 과제의 D-7/D-3/D-1 알림이 한꺼번에 뜨지 않아야 함 | 지난 알림 임계값 중 가장 가까운 한 개만 선택 | deadlineScheduler |
| 권한 화면이 실제 자료 폴더의 쓰기/읽기 가능 여부를 보여야 함 | 실제 dataRoot를 먼저 검사하고 ENOENT일 때만 존재하는 부모를 확인 | systemPermissions |
| 피드백에서 앱 정보 보내기를 끄면 버전·OS·테마가 모두 제외되어야 함 | 이전에는 버전만 제외됨. OS/테마도 null 처리하고 테마 getter도 호출하지 않음 | feedbackService |
| 진단 파일에 토큰·이메일이 포함되지 않아야 함 | 설정뿐 아니라 앱/플러그인 로그에도 가림 처리; OAuth code·refresh token·API key·JSON 자격증명 포함 | diagnosticsBundle |
| 학교 설정 저장 실패시 실제 저장 상태로 돌아오고 직접 추가한 입력은 재시도 가능해야 함 | 최신 요청 실패만 이전 선택으로 되돌리고 이전 실패가 새 선택을 덮지 않음. 직접 추가 폼은 저장 성공 후에만 닫음 | universityStore, SettingsUniversityPicker |

진단 가림은 credential 이름/이메일/자격증명 패턴만 대상으로 하며 로그의 일반 문장을 제거하지 않는다. 정규식에는 중첩된 무제한 반복이 없고 로그 입력은 파일당 2 MB 및 최종 bundle 2 MB로 제한된다. 패턴에 해당하지 않는 자유형 개인 정보 전체를 자동 익명화한다고 보장하지 않는다.

## 검증

- 수정된 가설의 표적 Vitest 16 파일, 71 테스트 통과(최종 파일별 실행 합계). 성공한 무관 검사를 반복하지 않았다.
- `pnpm exec tsc --noEmit -p tsconfig.node.json` 통과.
- `pnpm exec tsc --noEmit -p tsconfig.web.json` 통과.
- studyRunner 기존 출력 경로 예약 계약도 검사했으며, 기존 예약 동작은 유지했다.

## 실제 환경 검증 한계

실제 Google/Kakao 계정 로그인, macOS Keychain/화면 녹화/접근성 허용, 실제 사용자 피드백 전송, 자동 업데이트 설치/재시작은 실행하지 않았다. 운영 Supabase migration 적용 상태는 아래 2차 검토에 별도 기록했다. OAuth·네트워크·OS·업데이트 이벤트의 제어 가능한 대체 구현으로 경합과 오류를 검증했다. 서명·공증·배포 산출물 공개 검증은 통합 릴리스 단계에서 별도로 수행한다.

## 2차: 서버·SDK·웹 데모·원격 RLS

서버 marketplace Request 라우팅·JWT 검증·RLS client/service-role 역할 분리·artifact 조회/검토 경로, SDK CLI 생성/ZIP 패키징, manifest/ZIP/semver 계약, Supabase marketplace/whiteboard 정책과 웹 데모 adapter를 확인했다.

- 웹 데모에서 삭제한 대화의 지연 응답이 대화를 다시 만들고, 삭제한 필기의 늦은 autosave가 파일을 되살리는 문제를 수정했다. 대화별 이벤트 순서, 중복 전송 차단, 저장 공간 부족 시 오류/종료 이벤트, 같은 이름으로 필기 rename 시 불필요한 suffix도 수정했다. `tests/web-demo/adapter.test.ts` 4개 통과.
- `whiteboard_assets` 정책의 상관 서브쿼리 `w.group_id = group_id`가 실제로 내부 열끼리 비교되어 서로 다른 그룹의 보드·metadata를 결합할 수 있었다. storage UPDATE는 owner만 검사해 임의 경로 변경과 그룹 탈퇴 후 수정을 허용했다.
- 임시 PostgreSQL 14에 최소 auth/storage fixture와 원래 migration을 적용해 세 공격(서로 다른 그룹 metadata 삽입, 임의 storage path 이동, 탈퇴 후 storage 변경)이 성공함을 재현했다. 원본 데이터는 건드리지 않았고 임시 서버/데이터는 종료·정리했다.
- `20261007000000_whiteboard_asset_boundaries.sql`에서 외부 열을 명시하고 실제 보드·그룹·멤버십·경로를 SELECT/INSERT/UPDATE 경계에서 재검증한다. 과거 잘못 연결된 행을 임의로 삭제하거나 재작성하지 않는다.
- `supabase/tests/whiteboard_asset_boundaries.sql`은 빈 격리 DB에서 원본/수정 migration을 함께 적용하고 정상 insert/update 및 잘못된 metadata·path·탈퇴 후 수정 등 6개 경계를 검사한다. PostgreSQL에서 전부 PASS, 트랜잭션 rollback.
- 배포 경로는 CLI 연결 설정 파일 존재와 변수 이름의 존재 여부만 조사했고 비밀 값은 출력하지 않았다. root가 독립 SQL 리뷰 후 운영 `supabase db push --linked --yes`로 신규 migration 적용 성공을 확인했다. 실제 사용자 계정으로 권한 우회 시도를 운영에서 실행하지는 않았다.

## 3차: 플러그인 코드 실행 경계

`console.log.constructor('return typeof process')()`와 `module.constructor.constructor(...)`가 기존 Node vm의 `codeGeneration.strings=false`에서도 `object`를 반환했다. 호스트 객체·함수의 생성자는 Node realm에 속하므로 API 권한을 우회해 프로세스에 접근할 수 있었다. 재현은 process 존재 여부만 확인했고 환경변수/파일 비밀을 읽지 않았다.

Node vm의 prototype을 부분 차단하는 방식 대신 실행 위치 자체를 바꿨다.

- 플러그인마다 별도 비영속 세션과 `sandbox:true`, `contextIsolation:true`, 모든 Node integration=false인 unattached `WebContentsView`를 사용한다. 앱 창 목록/부모 선택/마지막 창 종료에 플러그인 실행 창이 섞이지 않는다. view wrapper는 종료까지 강하게 보유한다.
- 플러그인 코드는 이 Chromium OS 샌드박스의 Dedicated Worker에서만 평가한다. 모든 노출 함수·객체·오류·Promise는 브라우저 realm이며 Worker에 DOM/iframe/WebRTC가 없다. Node 프로세스에서 기본 evaluator를 호출하면 즉시 거부한다.
- 엄격한 CSP(`connect-src 'none'` 등), 세션에서 고정 문서/blob 외 요청 차단, 권한/탐색/팝업/다운로드 거부를 적용한다. 공식 [Electron 샌드박스 안내](https://www.electronjs.org/docs/latest/tutorial/sandbox)와 [보안 안내](https://www.electronjs.org/docs/latest/tutorial/security)의 OS sandbox+context isolation 경계를 따른다.
- source 파일은 main이 읽어 JSON으로 전달한다. preload의 contextBridge는 고정 채널의 문자열만 전달하며 이벤트/Node 객체를 넘기지 않는다. sender mainFrame·호스트 소유자 ID·라이프사이클 메시지 스키마·브로커 권한을 확인한다. 전체 IPC 전송량도 초당 200개로 제한한다.
- 기존 활성화/명령 timeout 외에 main의 nonce heartbeat로 무한 타이머 루프도 종료한다. OS 잠자기/메인 이벤트 루프의 긴 정지 후에는 새 challenge를 보내 정상 플러그인을 오판하지 않도록 한다. 오류 이유와 재시도 안내를 plugin lastError에 보존한다.
- 이전 utility-process entry/build를 제거하고 sandbox preload를 빌드에 추가했다. SDK/API·기존 플러그인 명령·설정·패널 계약은 유지한다.

검증: 관련 host/runtime/integration Vitest 3파일 30개 통과, node TypeScript 검사 및 production build 통과. 실제 Electron 임시 프로필에서 기존 단어 수 플러그인 명령·패널 통신 1개, 플러그인 v2 선택 편집/undo·설정·패널 복원·개발 폴더 재승인·재시작 5개, 신규 sandbox 공격/복구 1개를 통과했다. 신규 E2E는 module/console/URL/TextEncoder/API 함수/응답/오류/Promise/타이머 경로에서 Node 접근 불가, HTTP/WebSocket/file 직접 요청 차단(로컬 HTTP 서버 요청 0건), 창 목록 불변, 무한 루프 뒤 앱 생존 및 호스트 정리를 확인한다.

독립 리뷰 후 view 보유 수정과 OS sleep grace는 통합 빌드/E2E에 포함한다. Chromium 자체 취약점이나 승인된 권한의 오용을 완전히 막는다는 보장은 하지 않으며, Chromium 프로세스별 고정 메모리 한도는 없다. 실제 OS 잠자기/재개와 Windows sandbox 실행은 이 macOS 로컬 검사에서 수행하지 않았다.

2차 검토의 추가 마감: SDK는 이름이 `*.js`인 FIFO 등 비일반 파일을 동기 읽기하여 종료되지 않을 수 있어 일반 파일/디렉터리만 패키징한다. `pnpm plugin:test`에서 임시 FIFO의 즉시 거부, 생성·검증·결정적 ZIP·덮어쓰기 차단·예제 4개 검사가 통과했다(Windows에서는 FIFO 검사 제외). SemVer의 숫자를 Number로 변환하면 2^53 이상에서 서로 다른 버전이 같아지고 긴 숫자 prerelease가 Infinity가 되어 비교 대칭성이 깨졌다. 선행 0이 없는 숫자의 길이·사전순 비교로 정밀도를 유지한다. SemVer·manifest sanitize·runtime의 영향 검사 40개 통과.

독립 sandbox 리뷰 후 ready를 제외한 모든 메시지에 owner ID를 필수로 요구했다. 최종 sandbox E2E에는 raw transport owner 위조/승인하지 않은 API·importScripts·중첩 Worker의 직접 네트워크 접근도 포함했다. 일반 앱 계약 IPC의 sender allowlist는 별도 에이전트가 추가 검토·구현한다.
