# Google 웹 로그인 비교 검증

이 도구는 배포 앱과 동일한 실행 파일을 별도 복사하고, 기존 사용자 데이터와 분리된 환경에서 사람이 직접 Google 웹 로그인을 비교한다. 로그인 성공이나 지원 여부를 자동 판정하지 않는다. Drive/Gmail API 연동, OAuth 토큰 이동, 기존 브라우저 쿠키 가져오기는 수행하지 않는다.

## 실행

Node.js 24에서 이 기능이 포함된 공개 배포 설치 파일을 풀거나 설치한 뒤 실행한다. macOS는 서명·공증된 배포 앱을 사용한다. 현재 Windows 배포는 코드 서명이 없으므로 공개 패키지를 사용하고 미서명 상태를 결과에 함께 기록한다. 원본 앱을 수정하지 않으며, 앱 복사본만큼의 디스크 공간이 필요하다.

```sh
node scripts/browser-auth-probe.mjs --app /Applications/Bandal.app --mode product
node scripts/browser-auth-probe.mjs --app /Applications/Bandal.app --mode clean
node scripts/browser-auth-probe.mjs --app /Applications/Bandal.app --mode product --identity native
node scripts/browser-auth-probe.mjs --app /Applications/Bandal.app --mode clean --identity native
```

Windows에서는 `--app "C:\경로\win-unpacked\Bandal.exe"`처럼 패키지 실행 파일을 지정한다. 설치 프로그램 자체를 지정하지 않는다. 각 명령은 새로운 독립 폴더를 만든다. v0.79.6–v0.79.7에서는 계측 모드와 브라우저 식별 방식이 독립된 두 조건이었다. **v0.79.8에서는 `product`와 `native`가 모두 원래 식별값을 사용했다. v0.79.10부터 `product`는 실제 반달 이름·버전과 Chromium 엔진 정보를 유지하면서 Electron 라이브러리 토큰만 제외한 제품 식별값을 사용하고, `native`는 수정하지 않은 런타임을 비교 조건으로 유지한다.** 구버전과 비교할 때 앱 버전을 반드시 함께 기록한다.

| 모드 | 식별 방식 | 페이지 계측 | User-Agent 처리 |
|---|---|---|---|
| `product` | `product` (기본값) | 제품과 동일 | 반달 제품 식별값 |
| `clean` | `product` (기본값) | 제외 | 반달 제품 식별값 |
| `product` | `native` | 제품과 동일 | 런타임 기본값 유지 |
| `clean` | `native` | 제외 | 런타임 기본값 유지 |

`clean`은 앱의 페이지 JavaScript 주입과 제스처 preload를 끈다. v0.79.10의 제품 식별값은 세션·창 생성 전에 `app.userAgentFallback`에 한 번 설정한다. 개별 세션의 `setUserAgent`, 목적지별 헤더 가공, 다른 브라우저 이름·엔진 버전의 합성은 사용하지 않는다. Chromium의 실제 Client Hints도 그대로 둔다. 이 방식은 일반 탭·리다이렉트·팝업·프로필·시크릿 모드가 같은 식별값을 상속하게 한다. 모든 조건에서 네트워크 정책·보안 설정은 동일하다. 기본 Electron 전체와 비교하는 실험은 아니다.

앱 창 제목은 `Bandal 인증 비교 — product/clean`이며 원래 식별값 조건에는 `/ native identity`가 붙는다. 앱 계정 로그인과 온보딩은 필요하지 않다. 브라우저 탭을 열고 주소를 직접 입력한다. 시험 중에는 AI 작업이나 브라우저 자동화를 실행하지 않는다. Playwright, CDP, DevTools, 원격 디버깅 플래그를 연결하지 않는다. 앱은 이 실행에서 기본 프로토콜 등록·앱 업데이트·Finder 아이콘 변경을 수행하지 않는다.

런처가 출력한 폴더에는 앱 복사본, `user-data`, `data`, 실행 마커 `probe.json`, 비밀값을 포함하지 않는 버전 정보 `runtime.json`이 있다. 자동 로그 캡처는 하지 않는다. **로그인 후의 user-data에는 실제 세션이 저장되므로 폴더 전체를 공유하지 않는다.** 앱을 완전히 종료한 뒤 같은 세션을 다시 여는 명령은 다음과 같다.

```sh
node scripts/browser-auth-probe.mjs --resume /절대/경로/bandal-auth-probe-product-xxxxxx --mode product
node scripts/browser-auth-probe.mjs --resume /절대/경로/native-시험-폴더 --mode product --identity native
```

비교가 끝나면 해당 앱을 종료하고 런처가 출력한 전용 폴더만 삭제한다. `--resume`는 같은 모드·식별 방식·동일 복사본만 재사용한다. 첫 탐색 전 정한 식별 방식을 시험 중이나 호스트별로 바꾸지 않는다. 런처 마커나 경로가 일치하지 않으면 앱은 데이터 초기화 전에 실행을 거절한다. v0.79.4의 기존 시험 폴더와 런타임 응답에 식별 필드가 없으면 `product`로만 해석한다. `native`는 해당 기능이 포함된 새 공개 패키지가 필요하며 구버전 패키지는 실행 전에 거절한다.

## 판정

각 모드에서 개인 계정, 보호자 승인이 허용된 Family Link 관리 계정, Workspace 시험 계정으로 다음을 사람이 확인한다. 비밀번호·2단계 인증·조직 보안 절차는 계정 소유자가 직접 수행한다.

1. 빈 로그인 공간에서 개인 계정과 Workspace 계정의 신규 로그인을 각각 확인한다. Google 로그인 완료 후 Bandal 탭에서 Drive와 Gmail의 원본 웹 화면과 실제 계정을 확인한다. 이메일 입력·비밀번호 화면 도달만으로 성공 처리하지 않는다.
2. Google의 `다른 계정 추가`로 두 번째 계정을 추가하고 계정 메뉴에서 전환한다. 다른 탭과 함께 사용할 때 실제 계정과 콘텐츠를 확인한다.
3. 서로 다른 계정으로 로그인한 두 브라우저 프로필을 현재 탭에서 왕복 전환한다. 다른 프로필을 사용하는 별도 탭은 원래 로그인 상태를 유지하는지 확인한다.
4. 앱 종료 후 `--resume`로 다시 열어 세션 유지, 시험 공간에서 로그아웃 후 재로그인을 확인한다.
5. 거절되면 동일 기기·네트워크·계정의 지원 브라우저에서 비교한다. 같은 식별 방식에서 `clean`만 성공하면 앱 계측을 하나씩 복원하여 실패시키는 최소 조건을 찾는다. 같은 계측 모드에서 한 식별 방식만 성공하면 새로운 빈 공간에서 그 비교를 재확인한다. v0.79.8만 두 식별 옵션의 동작이 같으므로 이 버전에서는 UA 원인을 분리할 수 없다. 계측과 식별 방식을 동시에 바꾼 두 결과만으로 원인을 단정하지 않는다. 모든 조건이 실패하면 계정·조직·네트워크 영향과 내장 브라우저 제한을 분리하고, 필요할 때 같은 Electron 버전의 최소 구성으로 비교한다. 최소 구성도 거절되기 전에는 브라우저 구조가 원인이라고 확정하지 않는다.

v0.79.7까지 일반 제품은 대학 사이트 호환성을 이유로 Electron과 앱 이름을 제거했다. 이 가공은 일반 탐색과 팝업의 요청 식별값도 서로 다르게 만들었다. 2026-10-12 사용자가 앞서 제공한 `product / native identity` 시험의 성공과 일반 앱의 거절을 보고하여, v0.79.8에서 일반 제품도 원래 식별값을 유지하도록 수정했다. 연세대·KAIST의 공개 검사 코드는 원래 UA에 포함된 `Chrome/` 토큰을 인식하므로 두 토큰을 제거할 근거가 아니었다. 다른 Electron 프로젝트의 [재현 기록](https://github.com/stablyai/orca/issues/11518)은 참고 자료이며 Google의 공식 허용 조건을 뜻하지 않는다. 로컬 HTTP 회귀는 요청·JavaScript 식별값과 세션 일관성을 검사하고, 실제 계정의 로그인·계정 전환·2단계 인증은 공개 앱에서 별도로 확인한다.

v0.79.10 조사에서 동일 기기의 같은 Family Link 관리 계정은 Orca에서 로그인돼 있었지만 반달의 Google 웹 로그인은 `Family Link에서 관리하는 계정은 여기에서 로그인할 수 없습니다`를 표시했다. 계정·쿠키 없이 공개 `ServiceLogin`에 요청한 비교에서는 실제 `bandal/0.79.8 Chrome/150.0.7871.224 Electron/43.4.1` 식별값이 `WebLiteSignIn`으로, **반달·실제 엔진 토큰을 유지하고 Electron만 제외한 값**이 `GlifWebSignIn`으로 연결됐다. 이는 시작 흐름 분류 차이의 증거이며 로그인 성공의 증거는 아니다. 제품 전체의 식별값을 통일하여 일반 웹 흐름을 요청하며 `flowName`·승인 상태·계정 유형을 변경하지 않는다. Google이 계속 거절하면 해당 사유와 보호자 승인 필요성을 안내하고, 원래 서비스에서 새로 시작하거나 별도 기본 브라우저에서 열 수 있다. 외부 브라우저 로그인은 반달에 전달되지 않는다.

Google의 [브라우저 개발자 안내](https://developers.googleblog.com/en/guidance-to-developers-affected-by-our-effort-to-block-less-secure-browsers-and-applications/)는 실제 브라우저 식별과 완전한 웹 기능을 요구하며 다른 브라우저로의 위장을 금지한다. [Family Link의 웹 로그인 안내](https://support.google.com/families/answer/9043123?hl=ko)는 보호자 승인 아래 웹사이트 로그인을 지원한다고 설명한다. 반달 자체 식별값을 보내는 것이 Google의 공식 인증 또는 모든 관리 계정의 지원 보장을 뜻하지 않는다. 실제 계정의 최종 로그인·보호자 승인·서비스 접근은 공개 배포 앱에서 별도로 검증한다.

기록은 OS, 앱/Electron/Chromium 버전, 모드·식별 방식, 개인/Workspace 구분, 통과한 단계, 거절 종류와 호스트·경로에 한정한다. 이메일·이름·인증 URL query/fragment·쿠키·토큰·화면 속 개인 자료는 공유 기록에 포함하지 않는다. 서명되지 않은 로컬 빌드의 결과는 배포 앱 인증 성공의 근거로 사용하지 않는다. macOS·Windows의 공개된 동일 버전을 각각 확인하고 서명 상태를 구분한다.

런처는 실행 전 패키지에 이 기능의 표식이 있는지 확인하여 구버전을 거절한다. 실행 후에도 현재 실행의 식별자·PID·모드·식별 방식이 일치하는 새 런타임 응답을 20초 이내에 확인한다. 응답이 없으면 자신이 실행한 복사본 프로세스만 종료하고 실패를 보고한다. 이 확인은 격리 환경의 시작 확인이며 Google 로그인 성공 판정이 아니다.

공식 근거: Google은 앱에 내장되거나 자동화로 제어되는 브라우저의 로그인을 제한할 수 있다. [지원 브라우저 안내](https://support.google.com/accounts/answer/7675428?hl=ko). 두 계정 전환은 Google 웹 자체의 기능이며 브라우저 프로필과 동일한 개념이 아니다. [여러 계정 로그인](https://support.google.com/accounts/answer/1721977?hl=ko).
