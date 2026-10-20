# 브라우저 호환성·인증 검토 — 2026-10-21

검토 시작 기준은 `282a0af` / v0.86.0이다. 사용자 요청은 왼쪽 사이드바의
상단 여백 축소와 ChatGPT 홈 아이콘 hover 실패 조사, 브라우저 관련 코드 점검이다.
이 문서는 브라우저 코드 감사와 단위 회귀 결과를 기록한다. 릴리스 버전·커밋,
서명된 앱 E2E와 공개 배포 결과는 최종 통합 검증에서 별도로 확인한다.

## ChatGPT hover 조사 상태

**실제 ChatGPT 계정 화면에서 홈 아이콘에 마우스를 올려 사이드바가 열리는지는
아직 검증하지 않았다. 원인과 해결 여부를 이 기록에서 확정하지 않는다.**

인증·권한 수정은 아래에서 독립적으로 재현한 결함이다. 이 수정이 ChatGPT
hover 문제를 해결했다는 근거는 없다. 네이티브 페이지의 위치·가림 처리·포인터
전달과 viewport/hover 환경은 별도 조사 중이다. 로컬 재현 페이지의 DOM 이벤트
검사, 실제 외부 페이지 검사, 서명된 앱 검사는 서로 다른 증거로 기록해야 한다.

입력 담당의 추가 확인:

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
  미디어 쿼리가 true인 것은 확인했다. 로그인된 홈 아이콘 동작은 미확인이다.

## 점검 파일군과 확인한 동작

아래 표는 직접 읽은 중심 경로와 기존 회귀에서 확인하는 동작이다. 모든 파일의
모든 분기 또는 모든 외부 사이트를 실제 실행했다는 의미는 아니다.

| 파일군 | 코드에서 확인한 보존 동작 | 검증 범위 |
| --- | --- | --- |
| `nativeTabs.ts`, `browsingContext.ts`, `managedPages.ts`, `nativePageHandle.ts` | 네이티브 페이지는 앱 창·탭 소유권을 확인한다. 화면 배치 변경은 페이지를 다시 탐색하지 않는다. 이벤트의 WebContents ID·상태 revision으로 오래된 응답을 구분한다. | nativeTabs/nativePageHandle 및 browserAgent registry 회귀 |
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

이 차이들은 확인 가능한 범위 제한이다. 그 자체로 ChatGPT 홈 아이콘 hover 실패의
원인을 설명하지는 않는다. 원인은 포인터 이벤트·실제 페이지 레이아웃·앱 가림 상태의
재현 증거로 판단해야 한다.

## 실제 환경 검증의 경계

단위 검사는 모의 Electron 객체, DOM, 테스트용 파일·데이터를 사용한다.
로그인된 실제 ChatGPT 홈 화면, 사용자 키체인의 TLS 인증서, OS 카메라·마이크·화면
권한 허용, 학교 SSO, 개인 쿠키·저장 로그인 가져오기, 실제 DRM 재생은 실행하지
않았다. macOS·Windows 서명된 설치 파일과 자동 업데이트 피드 공개 확인은
릴리스 절차의 결과로 별도 기록해야 한다.
