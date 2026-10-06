# AI·브라우저·연결 기능 검토 — 2026-10-07

기준 커밋 `bf9557c` (0.71.0). 코드 읽기, 실패 재현, 회귀 검사를 구분했다.
이 기록은 모든 외부 사이트·모델·OS 환경에서 결함이 없다는 보증이 아니다.

## 기능별 검토 가설과 범위

| 기능 | 정상·실패·취소·전환 가설 | 읽은 주요 구현 / 검증 |
| --- | --- | --- |
| AI 대화·작성 | 전송 중 새 초안/첨부가 보존된다. 과목·대화·모델 전환 뒤 늦은 응답이 새 상태를 덮지 않는다. 승인/취소·세션 재시작이 정리된다. | `chatSessionStore`, `useChatSession`, `ChatSurface`, `Composer`, `composerDraftStore`, `ConversationListMenu`, `SessionManager`, event batching / 관련 단위 검사 |
| 도우미·AI 설정 | 준비 전 명령은 준비 뒤 한 번만 처리된다. 모델·제공자 오류는 복구 동작을 남긴다. | `assistantController`, `aiShortcutModel`, 관련 설정·접근 패널 / 기존 검사 |
| 브라우저 주소·탭·찾기 | 전환·히스토리·찾기에서 최신 입력이 적용된다. 한글 조합을 단축키로 오인하지 않는다. | `browserGuestsStore`, `BrowserAddressInput`, `useAddressSuggestions`, `BrowserFindBar`, `BrowserPanel`, `BrowserGuestView`, guest actions / 기존·신규 검사 |
| 브라우저 데이터·다운로드·가져오기 | 실패가 빈 데이터로 보이지 않는다. 재시도와 취소 동작을 제공한다. | browser session/history/download/import 구현과 설정 패널 / 관련 검사. 실제 프로필 가져오기는 실행하지 않음 |
| AI 웹 조작·권한 | 승인한 문서·턴만 조작한다. 중지한 작업은 재개되지 않고 다음 턴은 사용 가능하다. 입력·첨부 대상이 정확하다. | `browserTools`, `pageSurface`, `pageDriver`, `run`, refs/snapshot/actionPolicy, CDP, IPC commit bridge / 경합 회귀 |
| 저장 로그인 | 비밀은 암호화된다. 삭제 실패는 성공으로 표시되지 않는다. 채우기 전용 요청이 자동 제출하지 않는다. | credentialStore, loginFiller, loginCapture, SavedLoginsSettings / 오류 주입·DOM 검사 |
| MCP·도구·데스크톱 | 설정 삭제와 비밀 요약, 접근 승인·도구 예산, 취소·타임아웃이 일관된다. | registryStore/testConnection, McpServersPanel, agentTools server/handlers/context, desktopTools / 관련 기존·신규 검사 |
| 자료 연결 | 검색 실패 뒤 재시도 가능하고 연결 생성 실패에도 후보 선택을 유지한다. | materialLink/materialLinksRepo, LinkPickerDialog, useMaterialConnections / DOM 회귀 |
| 문맥·출처 | 문맥 예산·출처·삽입 문구 경계가 유지된다. | dossier/context 및 citation 관련 기존 검사 |

코드 읽기 표는 중심 실행 경로를 의미한다. 해당 영역의 모든 파일을 같은 깊이로
읽었다는 의미가 아니며 어댑터·레시피·가져오기 등의 기존 검사는 아래 실행 기록으로
구분한다. main 과목·자료·보드·일정·메일·검색·통계·즐겨찾기는 추가 라운드에서 기록한다.

## 재현하여 수정한 문제

1. **마지막 저장 로그인/MCP 서버 삭제 실패를 숨김**: 파일 삭제 실패를 삼키고 메모리만
   비워 재시작하면 항목이 돌아왔다. 임시 파일과 본 파일 삭제가 성공해야 캐시를 비우며,
   실패를 명시적으로 전달한다. 파일시스템 실패를 주입해 재현하고 재시도·재시작을 검증했다.
2. **승인 대기 중 문서 또는 턴 변경**: 사이트 허용·제출 승인·요소 정보 읽기가 기다리는
   동안 이동/새로고침/취소하면 이전 승인이 새 문서에 적용될 수 있었다. URL·문서 세대와
   비동기 도구 호출의 턴을 다시 검사한다. 사이트 권한 철회도 실행 직전에 확인한다.
3. **Enter로 제출 승인 우회**: 키 입력 API의 Enter가 폼/메시지를 제출할 수 있는데 별도
   제출 승인 없이 실행됐다. 기존 승인 정책을 통하여 한 번 사용 승인을 요청하며 승인 후
   문서와 턴을 재검사한다. 일반 키 입력에는 추가 승인을 요구하지 않는다.
4. **파일 첨부 대상이 첫 입력으로 바뀜**: snapshot의 전체 요소 인덱스를 CSS nth-of-type에
   적용하고 첫 file input으로 fallback했다. 이제 정확한 프레임의 snapshot 요소를 고유
   표식으로 CDP에서 찾으며 단일 유효 file input이 아니면 실행하지 않는다. iframe·다중
   입력·잘못된 대상·중복·실패 정리 회귀와 실행 타임아웃을 추가했다.
5. **AI의 채우기 요청이 저장된 자동 로그인 설정 때문에 제출됨**: main 전용 `allowAutoSubmit`
   override를 추가해 AI 채우기는 제출하지 않는다. 사용자 직접 로그인 설정은 유지한다.
   실제 JSDOM form을 채우고 requestSubmit이 불리지 않는 회귀를 추가했다.
6. **실행 배너/중지 수명 불일치**: 이미 열린 탭에서 시작한 AI 작업에는 실행이 없고, 끝난
   실행이 남아 다음 턴을 막거나 대화끼리 같은 실행을 공유했다. 대화·턴별 실행 범위를
   도입하고 완료·중단 시 정리한다. 기존 탭에서도 배너를 시작하고 탭 이동 시 옮기며,
   다음 턴은 새 실행을 만든다. 늦은 완료 이벤트는 같은 탭의 새 배너를 지우지 않는다.
7. **자료 연결 실패 뒤 복구 불가**: 생성 오류가 후보 목록을 대체했다. 후보와 오류를 함께
   유지하며 로딩 실패에는 Reload를 제공하고 중복 생성은 동기 latch로 막는다.
8. **브라우저 데이터 로딩 실패를 빈 상태로 표시**: 사이트 데이터·사이트 권한·로그인 목록
   조회 실패를 실제 빈 목록과 구분하고 각각 다시 읽기 동작을 제공한다. 로그인 저장소의
   일반 사용 불가 사유도 암호화 문제로 잘못 단정하지 않고 원인을 표시한다.
9. **찾기 Enter가 이전 검색 결과에 적용되고 한글 조합을 중단함**: debounce 전 Enter는
   최신 검색을 즉시 시작하고 예약 검색을 취소한다. 조합 중 Enter/Escape를 무시한다.
10. **AI 전송 대기 중 새 초안·첨부가 사라짐**: 전송 성공 시 전체 작성 상태를 비우던 경로를
    전송 스냅샷만 소비하도록 변경했다. 새 문자열/첨부/인용/중복 첨부·다른 창의 초안을
    보존하고 파일 가져오기 결과도 원래 파일만 교체한다. 이 경합은 코드 추적으로 확인하고
    snapshot 소비 회귀를 추가했다(새 helper 작성 전 실패 실행은 수행하지 않음).

## 로컬 검증

- 담당 기존 영역을 한 번 넓게 검사: **147개 파일 중 146 통과, 1 skip;
  1,221 tests 통과, 1 skip**. skip은 실제 Claude CLI 자격 증명이 필요한
  `tests/main/agent/smoke.test.ts`이다. 로그 `/tmp/bandal-ai-browser-audit-tests.log`.
- 수정별 검사: credentialStore + registryStore 41, loginFiller 10, CDP 12,
  LinkPicker 6, browser settings recovery 2, BrowserFindBar + guestActions 7,
  composer draft + mentions + ChatSurface 9 통과.
- 실행 수명과 승인 재검사 최신 회귀: browserTools 66개를 포함한 run/browserTools/
  renderer agentRuns **89개 통과**. pageDriver를 포함한 직전 실행 **113개 통과**.
- `tsc --noEmit -p tsconfig.node.json`, `tsc --noEmit -p tsconfig.web.json` 모두 통과.
  변경 후 직접 영향을 받는 검사만 재실행했다. 위 숫자는 서로 겹치므로 합산하지 않는다.

## 외부 검증 한계

실제 모델 계정, Gmail·학교 LMS, 저장된 개인 로그인, 실제 OS 권한 허용을 조작하지 않았다.
Electron guest/CDP 테스트는 모의 객체와 DOM을 사용하므로 외부 페이지의 cross-origin
iframe과 OS별 debugger 동작은 실제 패키지 검증과 구분한다. 승인 후 문서 재검사와
Chromium 작업 사이의 모든 외부 탐색을 원자적으로 잠그는 설계는 아니다. 통합 Electron
E2E·릴리스 패키지와 배포 결과는 상위 검토 기록에 별도로 기록한다.

## 추가 라운드: 과목·자료·일정·메일·검색·즐겨찾기

추가로 `coursesRepo/courseGroupsRepo/courseLinksRepo/courseFolder/folderAvailability`,
`materialsRepo/scanMaterialTree/watcher/mediaProgressRepo/mediaProtocol/textExtract`,
`boardRepo/calendarTime`, `appleCalendarService/appleCalendar`, `gmailService/gmailModel`,
`searchIndex`, `insights`, `favoritesRepo/descriptorJson`의 저장·읽기·오류 경로를 검토했다.
관련 renderer `CalendarView/CalendarSettingsPanel/TaskScheduleFields`,
`FavoritesSection/favoritesStore`도 검토했다. native/calendar는 상위 담당과 분리했다.

| 검토 가설 | 확인 결과 및 수정 |
| --- | --- |
| 삭제된 과목 정리가 다른 live 공간의 파일을 건드리지 않는다 | managed+soft-delete만으로 purge를 허용하면 폴더를 다른 공간으로 다시 등록한 뒤 휴지통 이동 대상으로 반환했다. 동일·하위·상위·symlink로 겹친 live 공간(보관 공간 포함)이 있으면 DB 삭제 전에 거부한다. 실패 재현 4개 후 통과. |
| 삭제 과목의 일정은 전역 보드·달력·마감에서도 사라지며 복원 가능하다 | 기존 조회는 task의 삭제만 검사했다. live 과목 소속 또는 global task만 조회하고 과목 복원 시 원래 일정이 다시 나타나게 했다. 3개 조회 경로+복원 회귀로 재현·수정. |
| 같은 과목을 다른 폴더에 다시 연결하면 검색도 새 원문을 보여준다 | 동일 relPath·mtime·size 텍스트와 동일 PDF 경로가 이전 내용으로 남았다. 검색 캐시에 과목의 폴더 결합을 영속 저장하고 변경 시 파생 인덱스/메타데이터를 초기화한다. 재시작과 늦은 background scan도 검사. |
| watcher 종료/재시도 대기 중 폴더를 바꾸면 옛 폴더를 수정하지 않는다 | rename/move가 원래 절대 경로를 캡처한 뒤 현재 과목 폴더를 재검사하지 않았다. 매 rename 시도 전 폴더 결합을 확인한다. 대기 중 relink 2개 재현·수정. |
| 메일 연결 해제 실패 후 화면과 재시작 상태가 같다 | Gmail credential unlink 실패 전에 memory token을 비웠다. 디스크 삭제 성공 뒤에 연결 상태를 비우고 실패는 재시도 가능하게 유지한다. 연결 해제 중 새 connect/API가 앞서 실행되지 않도록 수명을 묶었다. 파일 오류 주입 회귀 통과. |
| 큰 sparse Excel을 읽어도 미리보기 범위를 생성 전에 제한한다 | 모든 CSV를 생성한 뒤 500개 줄을 자르고 있어 column 폭을 제한하지 못했고 셀 안의 개행도 행으로 셌다. 파싱 시 행 상한, CSV 생성 전 500행/100열 상한, 생략 표시를 적용한다. 실제 xlsx 다중 행·넓은 열 fixture 재현 후 통과. |
| 달력 저장/삭제 응답이 새 선택을 되돌리지 않는다 | 선택 세대와 과목/월 범위를 확인해 저장 완료의 navigation·notice·list 적용을 제한한다. 중복 submit을 막고 저장 중 필드는 잠근다. 이전 range 응답은 완료된 save를 덮지 못한다. 날짜·월·과목 전환 및 늦은 load DOM 회귀 4개 통과. |
| Apple 설정의 focus/changed 조회가 저장 응답을 덮지 않는다 | mutation 시작 시 이전 조회를 무효화하고 mutation 중 중복 조회를 막는다. Calendar 수동 새로고침도 자동 새로고침과 같은 세대 검사를 사용한다. focus/저장 경합 DOM 회귀 2개 통과. |
| 즐겨찾기 scope 전환·동시 수정에서도 새 초안/항목을 보존한다 | scope별 폼을 재생성하고 이전 rename 완료는 같은 draft만 닫는다. 오래된 scope의 오류를 새 scope에 표시하지 않는다. 새 항목은 ID로 합치고, 이전 load를 무효화하며, 실패 rollback은 현재 항목·이름을 유지한 채 해당 변경만 되돌린다. DOM 3개와 store 8개 통과. |

과목/자료/메일/검색/XLSX 결함은 변경 전 실패 검사를 실행했다. 추가 renderer 경합은
코드 경로를 추적해 수정하고 지연 Promise를 사용하는 실제 DOM/상태 회귀를 추가했다.
그룹 정리·링크 URL·즐겨찾기 descriptor·달력 날짜·통계 및 media 범위의 기존 검사에서
새로운 실패는 없었다. 검토 중 확인한 오류를 모두 수정했지만 실제 외부 연동 전부를
실행했다는 의미는 아니다.

추가 검사 결과(서로 겹치는 실행을 합산하지 않음):

- coursesRepo + boardRepo + searchIndex: **89개 통과**.
- materialsRepo + materialsRepoRealPath + renameWithRetry: **64개 통과**.
- Gmail: **7개 통과**. 샌드박스의 localhost listen 제한 때문에 OAuth loopback fixture만
  허용된 실행으로 검사했다. 실제 Google 요청은 mock이며 개인 계정 연결/메일 전송 없음.
- textExtract: **10개 통과**.
- CalendarView DOM 4, CalendarSettings DOM 2, FavoritesSection DOM 3,
  favoritesStore 8: 각 관련 변경 후 통과.
- 추가 main/기존 renderer 범위 **15개 파일·119개 통과**:
  courseGroups/courseLinks/favorites/insights/appleCalendar/mediaProgress/mediaProtocol/
  backgroundMaterialsWatcher/backgroundClient/courseLinksToFavorites 및 날짜/즐겨찾기 동작.
- 추가 main 변경 후 Node·Web 타입 검사 통과. `git diff --check` 통과.

## native browser-import 경계 정적 검토

`native/browser-import/main.swift`, `native/browser-import/Program.cs`와 이를 호출하는
`browser/import/crypto.ts`, sqlite/readers/service 흐름을 추가로 읽었다.

- Swift helper는 keychain 요청의 서비스명을 Chrome/Edge Safe Storage 두 개로 제한하고
  OS Keychain 응답만 반환한다. Windows helper는 현재 사용자 DPAPI만 사용하며
  elevation이나 app-bound 복호화 우회를 하지 않는다.
- 두 helper에는 임의 파일 경로·실행 명령 인자가 없다. 비밀을 argv/환경/로그 대신
  inherited pipe로 전달하며 self-test 분기는 실제 비밀을 조회하지 않는다.
- parent는 helper timeout/abort, 출력 상한, 일반 오류 변환을 적용한다. 가져오기는
  private source ID에서 원본 경로를 해석하고 읽기 전용 SQLite 트랜잭션을 사용한다.
- 저장 전 HTTPS 로그인 제한, 비지원 암호화/분할 쿠키 제외, 취소 후 추가 쓰기 중지,
  완료 job에는 집계만 남기는 경로를 확인했다. 관련 synthetic profile 회귀는 초기
  브라우저 영역 검사에 포함됐다.
- 실제 Keychain 허용, Windows DPAPI, 타 사용자 데이터 또는 브라우저 개인 프로필을
  실행 검증하지 않았다. 이 라운드에서 native helper 자체의 수정은 없었다.

최종 동시 제어 점검에서는 대화별 실행을 분리한 뒤에도 **한 탭에는 한 대화만** 제어권을
갖도록 보완했다. 다른 대화가 이미 사용 중인 탭을 새로 잡거나 그 탭으로 이동하면 이유를
표시하며 거부한다. 중지된 대화는 새 소유자의 작업을 계속할 수 없다. 다른 탭의 대화는
병렬로 동작한다. 이 경합 2개를 실패 재현 후 수정했고 run/browserTools/renderer agentRuns
최종 묶음 **91개 통과**. 탭 등록 충돌은 pending open을 실패로 완료해 대기 상태가 남지 않는다.
