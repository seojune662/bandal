# 브라우저 호환성·인증 검토 — 2026-10-21

검토 시작 기준은 `282a0af` / v0.86.0이다. 사용자 요청은 왼쪽 사이드바의
상단 여백 축소와 ChatGPT 홈 아이콘 hover 실패 조사, 브라우저 관련 코드 점검이다.
이 문서는 브라우저 코드 감사와 단위 회귀 결과를 기록한다. 릴리스 버전·커밋,
패키지 E2E와 공개 배포 결과는 최종 통합 검증에서 별도로 확인한다.

## ChatGPT hover 원인과 확인 증거

**로그인된 실제 ChatGPT에서 문제를 재현했다. 사이트 상단 `HEADER`의
`app-region: drag`가 Electron의 네이티브 창 드래그 영역으로 해석되어
홈 아이콘 위의 실제 마우스 입력에 간섭했다. 해당 영역을 해제한 뒤 사용자가
사이드바가 열린다고 직접 확인했다.**

사용자가 로그인한 별도 테스트 앱에서 확인한 `HEADER`는 높이 52px,
`pointer-events: none`, `app-region: drag`였다. DOM의 `pointer-events`와 별도로
Electron/Cocoa의 네이티브 hit test에 드래그 영역이 남았다. 이 때문에 DOM 이벤트
핸들러나 마우스 capability 값만 점검해서는 결함이 드러나지 않았다.

원인 확인을 위해 해당 페이지 전체의 app-region을 해제하는 CSS를 주입했다.
사용자는 변경 뒤 **“이제 열림”**이라고 확인했다. 이 증거는 실제 계정의 실제
커서 경로에서 얻었으며, 아래 초기 로컬 `sendInputEvent` 검사보다 강한 근거다.
다만 런타임 주입 확인과 저장된 수정의 릴리스 패키지 검증은 구분한다.
영구 수정은 `pageInput.ts`를 `attachNavigationPolicies`에서 연결하여 현재 문서와
새 `dom-ready` 문서에 user-origin 스타일을 적용한다. author의 inline
`!important`보다 우선하도록 설계했으며 CSS 값과 실제 native hit test의 효력은
Electron 실행 검증으로 확인한다. 단위 검사만으로 shadow DOM이나 모든 iframe의
스타일 적용 범위를 보장하지 않는다.

이후 영구 수정이 포함된 개발 앱을 같은 로그인 테스트 프로필로 다시 실행했다.
로그인된 Home 아이콘이 있는 문서에서 `temporaryStyle: false`로 임시 주입
스타일이 없음을 확인했고, 원인 `HEADER`의 계산된 app-region은 `none`이었다.
새로고침 뒤에도 동일했다. 따라서 단발성 콘솔 주입에만 의존하는 상태가 아님을
확인했다. 최종 배포 패키지와 Windows에서의 확인은 별도 릴리스 검증 대상이다.

초기 조사와 당시 검사의 한계:

- nativeTabs·guest input·gesture preload와 selection/login/video/diagnostics
  브리지에서 mouse/pointer 이벤트를 차단하는 `stopPropagation` 경로 또는
  `setIgnoreMouseEvents` 호출은 발견하지 못했다.
- `e2e/browserHover.spec.ts`의 로컬 hover 시나리오 **1개 통과**:
  클릭 없이 trusted pointerenter/mouseenter/pointermove/mousemove와 CSS `:hover`,
  지연 사이드바 표시, 주소 제안 닫힘 뒤 네이티브 페이지 복원, 창 너비
  1560/1024, iframe을 검사했다.
- 이 검사는 `WebContents.sendInputEvent`로 guest에 입력을 보낸다.
  **OS 커서가 앱 창을 통과하여 해당 view를 선택하는 경로까지 증명하지 않는다.**
- 로그인되지 않은 실제 ChatGPT 페이지의 viewport 너비 704px에서 hover/fine
  미디어 쿼리가 true인 것은 확인했다. 이 초기 관찰만으로 로그인된 홈 아이콘의
  문제를 판정하지 않았고, 이후 위 실제 계정·커서 경로에서 원인을 확인했다.

아래 인증·권한 수정은 독립적으로 재현한 추가 결함이며 hover 수정의 원인은 아니다.

## 점검 파일군과 확인한 동작

아래 표는 직접 읽은 중심 경로와 기존 회귀에서 확인하는 동작이다. 모든 파일의
모든 분기 또는 모든 외부 사이트를 실제 실행했다는 의미는 아니다.

| 파일군 | 코드에서 확인한 보존 동작 | 검증 범위 |
| --- | --- | --- |
| `nativeTabs.ts`, `browsingContext.ts`, `managedPages.ts`, `nativePageHandle.ts` | 네이티브 페이지는 앱 창·탭 소유권을 확인한다. 화면 배치 변경은 페이지를 다시 탐색하지 않는다. 이벤트의 WebContents ID·상태 revision으로 오래된 응답을 구분한다. | nativeTabs/nativePageHandle 및 browserAgent registry 회귀 |
| `pageInput.ts`, `hardenWebviews.ts` 입력 정책 연결 | 웹사이트의 app-region이 반달 창 드래그 영역으로 사용되지 않도록 user-origin 스타일을 적용한다. 이미 열린 문서와 새 문서를 모두 처리하고 탐색·종료 중 삽입 실패를 처리한다. | 아래 35개 직접 영향 회귀, 실제 로그인 ChatGPT에서 사용자 hover 확인, 영구 수정 개발 앱 재실행·새로고침 뒤 계산값 확인; 배포 패키지 검증은 별도 |
| `hardenWebviews.ts`, `webviewPolicy.ts`, `popupLifecycle.ts`, `popupLimiter.ts` | 사이트가 연 팝업은 Chromium의 원래 WebContents·POST·referrer·opener 연결을 유지한다. 실제 다운로드 완료 뒤 빈 다운로드 창만 닫는다. 작성된 `about:blank` 문서는 보존한다. 팝업 제한과 외부 스킴 처리는 별도로 유지한다. | 탐색 정책·팝업 제한·네이티브 탭·다운로드 회귀; 실제 인증 사이트 POST는 실행하지 않음 |
| `profiles.ts`, `sessionStore.ts`, `permissionsRepo.ts`, 관련 `registerHandlers.ts` 경로 | 일반·시크릿·프로필 세션을 분리한다. 마지막 시크릿 페이지와 다운로드가 종료된 뒤 저장소·캐시·인증 캐시를 정리하고, 정리 중 새 페이지가 앞서 생성되지 않도록 기다린다. 사이트 데이터 삭제는 쿠키 외 저장소 삭제 경로를 제공한다. | privateSession/sessionStore/profile 및 IPC 계약 회귀 |
| `browserIdentity.ts`, `embeddedAuth.ts`, `googleAccountNavigation.ts`, `browserAuthForwarding.ts` | 실제 Chromium 엔진·플랫폼 UA를 보존한다. 알려진 인증 제공자의 명시적 거절만 외부 인증 안내 대상으로 삼는다. Google 계정 선택은 제한된 원래 탐색 경로에만 전달하고 재탐색·POST를 자동 반복하지 않는다. | identity/auth observer/account navigation 및 renderer forwarding 회귀 |
| `httpAuth.ts`, 인증서 선택·사이트 권한 핸들러 | HTTP 인증과 TLS 클라이언트 인증서 선택은 네이티브 UI를 사용한다. 이번 검토에서 입력 충돌과 요청 미완료 경로를 수정했다. | 아래 실패 재현과 신규 직접 회귀 |
| `downloads.ts`, `linkDownload.ts`, `driveUrl.ts`, `downloadsStore.ts` | 과목 다운로드는 임시 파일에 받은 후 자료로 편입한다. 편입 실패는 전송 실패와 구분하고 복구 경로를 남긴다. 과목 없는 다운로드도 완료 상태와 저장 위치를 알린다. | 다운로드 진행·취소·편입·링크 파일명·Drive URL 회귀 |
| `pageClose.ts`, `BrowserGuestView.tsx`, `BrowserErrorPage.tsx`, `loadError.ts`, `guestActions.ts` | beforeunload 선택을 탭 닫기·프로필 변경에 연결한다. Chromium `ERR_ABORTED`를 일반 페이지 오류로 표시하지 않는다. 렌더러 종료와 네트워크 오류를 구분하여 재시도 동작을 제공한다. | close/loadError/native transport/guest actions 및 renderer 회귀 |
| `BrowserFindBar.tsx`, 브라우저 주소·상태·메뉴 구성요소 | 찾기는 최신 입력을 적용하고 한글 조합 중 Enter/Escape를 무시한다. 주소 입력·탭 상태·메뉴·native visibility와 occlusion의 기존 회귀를 확인했다. | `tests/renderer/browser` 전체 회귀 |
| `permissionPolicy.ts`, `displayMedia.ts`, `trackingProtection.ts`, `extensionManager.ts` | 권한 정책·화면 선택·추적 요청 필터·확장 manifest 지원 범위를 확인했다. 호환성 문제를 이유로 sandbox·webSecurity·인증서 검증을 완화하지 않았다. | permission/tracking/extension 회귀; 실제 OS 화면 공유·장치 허용은 실행하지 않음 |
| 브라우저 가져오기, `browserAgent`, preload browser gesture, 공용 browserAuth 및 IPC 계약 | 이번 라운드에서는 주로 기존 회귀를 통해 암호화·파싱·탭 제어·승인·제스처·IPC 연결 경계를 확인했다. | 관련 테스트를 한 번 실행; 사용자 브라우저 프로필·개인 데이터는 가져오지 않음 |

## 재현하여 수정한 문제

1. **HTTP 인증 입력값 `cancel`이 취소와 충돌했다.**
   네이티브 입력창이 값과 취소를 같은 `bandal-auth:` 주소 공간으로 전달했다.
   아이디나 비밀번호가 문자 그대로 `cancel`이면 인증을 끝내 버렸다.
   제출은 `bandal-auth:submit/…`, 취소는 `bandal-auth:cancel`로 구분했다.
   실제로 생성되는 입력창 HTML의 script를 실행하는 회귀로 기존 실패를 재현했고,
   `cancel`·빈 문자열·한글·URL 예약문자 입력을 검사했다.
2. **클라이언트 인증서 취소가 Chromium 요청을 끝내지 않았다.**
   인증서 목록이 비었거나 사용자가 취소하면 callback을 호출하지 않았다.
   선택창 Promise가 실패할 때도 요청이 미완료로 남고 unhandled rejection이 발생했다.
   모든 거절·오류 경로에서 인증서 없는 callback으로 완료한다. 선택한 인증서는
   기존처럼 해당 목록의 항목만 전달한다. 목록 0/1/2개 취소와 대화상자 실패,
   명시적 선택을 검사했다. 취소·오류 4개 실패를 수정 전에 재현했다.
   인자 생략은 [Electron app API의 select-client-certificate 계약](https://www.electronjs.org/docs/latest/api/app#event-select-client-certificate)을 확인했다.
3. **사이트 권한 선택창 실패가 요청을 끝내지 않았다.**
   `askSitePermission(...).then(callback)`에 rejection 처리가 없어 응답 callback이
   호출되지 않았다. 오류 주입으로 실패와 unhandled rejection을 재현한 뒤
   `callback(false)`로 거절을 완료하도록 수정했다. 이후 새 요청의 허용도 검사했다.
4. **HTTP 인증 선택창 실패 뒤 요청이 미완료로 남을 수 있었다.**
   같은 비동기 오류 경로를 코드 추적으로 확인했다. `resolveAuthPrompt`는
   오류 시 취소 결과를 반환하고 기존 `finally`에서 진행 중 상태를 정리한다.
   실패 뒤 다음 인증 요청이 정상 완료되는 회귀를 추가했다.
5. **사이트의 `app-region: drag`가 실제 브라우저 마우스 입력을 가로챘다.**
   로그인된 ChatGPT에서 확인한 사이트 CSS가 Electron 창의 native drag region을
   만들어 hover를 막았다. 브라우저 콘텐츠에만 입력 정책을 적용하고 반달 자체
   창 제목 표시줄은 기존 드래그 동작을 유지한다. 원인·사용자 확인 증거는 위에
   기록했다. 일반 DOM hover 테스트 성공을 실제 OS 마우스 경로 성공으로
   간주하지 않는다.

## 로컬 검사 결과

수정별 직접 회귀는 다음 세 파일에서 **43개 통과**했다.

- `tests/main/browser/httpAuth.test.ts`
- `tests/main/browser/hardenWebviews.test.ts`
- `tests/main/browser/hardenWebviewsIdentity.test.ts`

사용자가 브라우저 전체 점검을 요청한 범위에 따라, 위 43개를 제외한 브라우저
관련 기존 회귀를 한 번 실행했다. **74개 파일·926개 테스트 모두 통과**했고
신규 실패는 없었다. 필터 `tests/main/browser`에는 `tests/main/browserAgent`도
포함된다. 브라우저와 무관한 앱 전체 검사로 확대하지 않았다.

```sh
pnpm exec vitest run \
  tests/main/browser tests/renderer/browser tests/preload/browser \
  tests/shared/browserAuth.test.ts tests/main/browserAgent/navigation.test.ts \
  tests/main/ipcCoverage.test.ts \
  --exclude tests/main/browser/httpAuth.test.ts \
  --exclude tests/main/browser/hardenWebviews.test.ts \
  --exclude tests/main/browser/hardenWebviewsIdentity.test.ts
```

두 묶음은 중복되지 않으며 합계 **77개 파일·969개 테스트**다.
이는 이 감사 담당 범위의 실행 시점 결과이고 이후 통합 변경의 최종 검사 수치와
구분한다. 변경 파일의 `git diff --check`도 통과했다. 타입 검사와 패키지 E2E는
통합 담당이 수행하므로 이 단계에서 중복 실행하지 않았다.
이후 통합 담당이 영구 입력 수정의 앱 빌드와 main·renderer 타입 검사 통과를
확인했다.

실제 hover 원인을 확인한 뒤 직접 영향을 받는 검사만 추가 실행했다.
`pageInput.test.ts` 6개와 입력 정책 연결을 포함한 `hardenWebviews.test.ts`,
`hardenWebviewsIdentity.test.ts`의 **3개 파일·35개 테스트 통과**다.
기존 검사와 겹치므로 위 969개에 이 실행 수치를 그대로 합산하지 않는다.
새 회귀는 이미 열린 팝업의 즉시 적용, 문서 교체, 이전 문서의 늦은 rejection,
종료 도중 rejection, 이미 닫힌 페이지, 중복 정책 연결을 검사한다.
mock 객체로 확인하는 수명 검사이며 CSS cascade와 native hit test는 실행 앱에서
검증해야 한다.

영구 수정 앱에서 브라우저 호환성 E2E 23개를 통과했다. 확장한 hover 회귀는
실제와 같은 52px 드래그 헤더, inline `!important`·가상 요소·동적으로 추가한
요소의 계산값 `none`, 주소 제안·툴팁 복원·크기 변경·iframe·탐색·새로고침·자식
탭의 지연 hover를 검사한다. 첫 실행에서는 페이지에 trusted hover가 도착한 뒤
OS 실제 커서로 재동기화되어 닫히는 시험 경합을 확인했다. native view 복원을
기다리고 지연 표시 시점의 실제 계산된 CSS 상태를 기록하도록 검사를 보완했다.
수정 후 해당 검사 5회 모두 통과했으며 제품 코드를 추가로 바꾸지 않았다.

## Chromium 엔진과 Chrome 제품의 차이

반달은 `package.json`의 Electron 43.4.1 의존성과 Electron `WebContentsView`로
웹 페이지를 표시한다. 이 저장소는 Google Chrome 제품 전체를 포크한 구현이 아니다.
Chromium 렌더링 엔진을 사용해도 탭·팝업·권한·화면 공유·확장·native view 배치 같은
브라우저 제품 동작은 반달의 구현과 설정에 영향을 받는다.

현재 코드에서 확인되는 제품 차이는 다음과 같다.

- `browserIdentity.ts`는 Electron 라이브러리 토큰을 제거하고 반달 제품명을
  표시하되 실제 Chrome 엔진·플랫폼 토큰을 보존한다. 사이트별로 Chrome 버전을
  꾸미거나 Client Hints를 제거하는 수정은 하지 않았다.
- `permissionPolicy.ts`는 Widevine CDM이 포함되지 않은 현재 빌드에서
  `mediaKeySystem`을 거절한다. DRM 재생의 Chrome 동등성을 보장하지 않는다.
- 확장 설치는 `extensionManager.ts`가 허용한 Manifest V3 일부 기능으로 제한된다.
  Chrome Web Store 확장 전체가 지원된다고 볼 수 없다.
- `fileSystem`, USB/HID/serial 등은 현재 정책에서 거절한다. 전체 장치·파일
  API의 Chrome 동등성을 만들려면 선택 UI와 권한 수명을 포함한 별도 구현이 필요하다.
- `displayMedia.ts`는 화면·창 선택 후 영상 소스를 반환하며 시스템 오디오는
  반환하지 않는다. 이번 수정에서 이 동작은 변경하지 않았다.

이 차이들은 확인 가능한 범위 제한이다. ChatGPT 홈 아이콘 hover 실패는 위의
사이트 app-region과 Electron native drag 처리의 조합으로 따로 재현·확인했다.

## 실제 환경 검증의 경계

단위 검사는 모의 Electron 객체, DOM, 테스트용 파일·데이터를 사용한다.
로그인된 실제 ChatGPT의 hover는 사용자가 테스트 창에 로그인한 뒤 제한된
런타임 수정으로 확인했다. 영구 수정 개발 앱은 같은 프로필의 재실행·새로고침에서
임시 스타일 없이 원인 CSS가 초기화됨을 확인했다.
사용자 키체인의 TLS 인증서, OS 카메라·마이크·화면
권한 허용, 학교 SSO, 개인 쿠키·저장 로그인 가져오기, 실제 DRM 재생은 실행하지
않았다. 영구 수정이 포함된 macOS 서명·공증 설치 파일과 Windows 미서명 설치
파일, 업데이트 피드 공개 확인과 최종 앱 E2E는 릴리스 절차의 결과로 별도
기록해야 한다. Windows 코드 서명은 현재 적용되지 않는다.

## 통합 및 배포 검증

브라우저 입력 수정 커밋은 `6850c9c`다. 동시에 진행된 공식 커뮤니티 변경을 보존해
통합했으며, `26f8d40` / v0.87.2까지 검증했다. 통합된 개발 앱에서
사이드바·전체화면·hover E2E 11개를 통과했다.

v0.87.1은 새 커뮤니티 IPC 모듈의 검사 수집 경로와 이전 메뉴 이름을 기대하던
검사 세 건이 실패해 공개 전에 중단됐다. 실제 IPC 연결은 존재했고, 검사 목록과
기대값을 수정한 뒤 두 파일의 23개 검사를 통과했다.

[v0.87.2 CI](https://github.com/seojune662/bandal/actions/runs/39481506827)는
182개 파일·1,169개 단위 검사 통과(1개 파일·11개 검사 건너뜀), 별도 백엔드 통합
11개, 검사 선택 스크립트 68개·대비 검사 1개와 main·renderer·web-demo 타입 검사
통과로 완료됐다. 릴리스는 같은 커밋의 성공 결과를 재사용했다.

v0.87.2는 Windows 패키지 E2E의 두 실패로 공개하지 않았다. 자료 검색 결과에는
미리보기의 `position: fixed`, `visibility: hidden`, `pointer-events: none`이
잘못 적용되는 실제 CSS 오류가 있었다. 노트 섹션 스타일 제거 때 남은 selector의
쉼표가 다음 미리보기 규칙에 연결된 원인이며, 검색 행의 3열 grid 규칙을 독립
복원했다. 수정 전 실제 Chromium에서 숨김 상태를 확인했다.

다른 실패는 Windows에서 툴팁이 표시되지 않는 자동 hover 검사였다. 기존 자료
미리보기 검사에서 사용하던 방식대로 Windows에 한해 OS 커서와 Chromium 좌표를
배율·DPI에 맞춰 정렬한다. 실제 툴팁 표시, native view 가림과 복원 단언은
유지한다. macOS에서는 OS 커서를 조작하지 않는다. 이 보완의 Windows 효력은
후속 패키지 실행으로 확인하며, 원래 ChatGPT 문제의 원인과 구분한다.


v0.87.3의 [CI](https://github.com/seojune662/bandal/actions/runs/39484117978)는
위와 같은 영향 검사 범위를 통과했다. [패키지 검사](https://github.com/seojune662/bandal/actions/runs/39484123080)에서
macOS 60개가 모두 통과했고 Windows는 59개 통과·1개 실패로 공개하지 않았다.
자료 검색과 툴팁 복원은 양쪽 플랫폼에서 통과했으며, 남은 실패는 새로고침 뒤
Home에 실제 커서가 남아 있는 동안 자동 검사가 이벤트 기록을 지우는 경합이었다.
실제 지연 표시(block·hover 배경색)는 성공했지만 그 표시를 발생시킨 enter 기록이
검사 코드에서 삭제되어 trusted enter 단언만 실패했다.

후속 검사는 이벤트 로그를 삭제하지 않고 각 지연 표시를 실제 enter 인덱스에
연결한다. Windows에서는 앱 UI뿐 아니라 페이지 이동에도 OS 커서와 자동 입력
위치를 함께 맞춘다. 클릭 없이 trusted 이벤트와 계산된 지연 표시를 확인하는
기존 단언을 유지한다. OS 커서 이동 뒤 Chromium 입력도 보내므로 이 자동 검사가
OS 입력만의 성공을 독립 증명한다고 해석하지 않는다. 실제 사용자 마우스로 확인한
로그인된 ChatGPT 결과와 계산된 app-region 검사를 함께 근거로 사용한다.

보완 후 macOS의 해당 회귀 1개를 통과했고, [Windows 전용 반복 검사](https://github.com/seojune662/bandal/actions/runs/39486862994)에서
패키징한 앱의 hover 회귀 5회가 모두 통과했다(재시도 0회). 진단용 브랜치의
검사 수정만 v0.87.4에 포함하며 임시 워크플로는 main에 포함하지 않는다.

## v0.87.4 최종 검증

배포 앱 커밋은 `123bcfb9ccd611da04f6bfa29d39cd260e93cc04`이며
태그 `v0.87.4`와 `package.json`의 `0.87.4`가 일치한다.

- [최종 CI](https://github.com/seojune662/bandal/actions/runs/39487619899):
  182개 파일·1,169개 단위 검사 통과(1개 파일·11개 검사 건너뜀), 별도 백엔드
  통합 11개, 검사 선택 스크립트 68개·대비 검사 1개, 관련 타입 검사 통과.
- [최종 패키지 검사](https://github.com/seojune662/bandal/actions/runs/39487620348):
  macOS 60개·Windows 60개 모두 통과했다. 양쪽에서 hover, 사이드바, 자료 검색을
  포함한 변경 기능을 검증했으며, 릴리스는 같은 커밋의 성공한 CI를 재사용했다.
- macOS arm64·x64 설치 파일의 서명·공증, 캘린더·사진 선택·공유 확장·브라우저
  가져오기 도우미 검증을 통과했다. Windows 가져오기 도우미도 검증했다.
  Windows 설치 파일은 기존과 같이 미서명이다.
- [v0.87.4 릴리스](https://github.com/seojune662/bandal/releases/tag/v0.87.4)는
  2026-10-21 05:16 KST에 공개됐다. 업로드 단계에서 12개 파일의 크기·SHA-256을
  검증했으며, 공개 후 인증 없는 HEAD 요청 12개가 모두 HTTP 200이었다.
  `latest-mac.yml`과 `latest.yml`을 직접 읽어 버전 `0.87.4`를 확인했다.
- 웹 커밋 `f2d671f0f70167ada8c2df418a3d364e30a454d5`의 Production 배포
  `7210061986`이 성공했다. `bandal.io/`, `/en/`, `/changelog`, `/en/changelog`는
  모두 HTTP 200·v0.87.4를 표시하며, ARM·Intel·Windows 최신 다운로드 링크는
  모두 v0.87.4 설치 파일로 이동한다. 이미 진행된 웹 반영을 확인해 중복 실행하지 않았다.
