# 브라우저 프로필·채팅 계층·탐색 제스처

기존 `persist:browsing` 세션을 기본 프로필로 유지한다. 새 프로필은 UUID별
Electron 세션, browser.sqlite(방문 기록·사이트 권한), OS 암호화 로그인 저장소,
확장 목록을 갖는다. 탭 payload의 `profileId`가 없으면 기본 프로필이다.
일반 세션과 시크릿 세션은 프로필 안에서도 분리된다. 사이트가 여는 자식 탭은
부모 세션과 과목을 상속한다. 프로필 전환은 원래 페이지의 beforeunload를 거치며
취소하면 기존 페이지를 유지한다. URL을 새 프로필에서 열되 POST는 재전송하지 않는다.

다운로드·링크 저장·PDF 인쇄용 원본 요청·파비콘·자동 로그인도 해당 세션을 쓴다.
과목 자료와 즐겨찾기는 공유된다. 삭제는 확인 후 진행하며 사용 중인 탭이나
다운로드가 있으면 거절한다. 삭제된 프로필의 오래된 탭은 다른 계정으로 자동 연결하지 않는다.

## 웹사이트 로그인과 반달 계정

반달에 로그인한 학교 계정은 반달 앱 계정이다. ChatGPT 등 웹사이트의 로그인과
구독은 별개이며, 각 브라우저 프로필에서 해당 사이트에 원하는 계정으로 로그인한다.
프로필을 바꾸면 해당 프로필에 보관된 쿠키를 사용하므로, 기존 계정의 로그인 상태를
다른 프로필로 복사하지 않는다. 진행 중인 Google/OpenAI 인증 주소에서 프로필을
바꾸면 OAuth state를 재사용하지 않고 해당 서비스의 시작 페이지에서 다시 로그인한다.

Google은 내장 브라우저의 로그인을 제한할 수 있다. '브라우저 또는 앱이 안전하지
않을 수 있습니다'는 계정이 서로 달라서 발생하는 오류가 아니다. 이 응답이 나중에
화면에 그려지는 경우까지 감지하여 기본 브라우저에서 사이트를 여는 안내를 표시한다.
일회성 인증 주소를 전달하지 않고 원래 서비스에서 새 로그인 절차를 시작한다.
기본 브라우저의 로그인 쿠키는 반달로 자동 전달되지 않으므로, Google 로그인이
차단되는 사이트는 기본 브라우저에서 계속 사용해야 한다. UA 위장, 보안 설정 해제,
OAuth 토큰 이동으로 이 제한을 우회하지 않는다.

공식 근거:
- [Google — 지원되는 브라우저로 로그인](https://support.google.com/accounts/answer/7675428?hl=ko)
- [Google — 내장 웹뷰 OAuth 보안 정책](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)

앱 내부 AI 채팅은 HTML보다 위에 있는 네이티브 브라우저와 함께 사용할 수 있도록
메인 창에 종속된 자식 BrowserWindow에서 표시한다. 닫을 때 숨겨 입력 초안을
보존하고, 메인 창의 이동·최소화·전체 화면을 따른다. 데스크톱 상시 표시 오버레이와
구분하며 앱 전체를 always-on-top으로 올리지 않는다. 웹 데모는 기존 HTML 채팅을 유지한다.

두 손가락 탐색은 브라우저 세션 전용 격리 preload로 구현한다. 앱 IPC를 웹사이트에
노출하지 않고 trusted wheel 입력만 처리한다. 가로 스크롤·overscroll containment,
세로 스크롤·핀치·수정키를 구분하고 제스처 종료 후 한 번 탐색한다. macOS의
기존 swipe와 같은 중복 방지기를 사용한다. 설정에서 끌 수 있다.

검증 범위: 프로필별 쿠키/저장소/기록, 자식 창 상속, 동시 계정, 재시작 복원,
beforeunload 취소, 채팅과 웹페이지 동시 사용, 수평 스크롤 및 cross-origin iframe.
Electron 입력 이벤트로 자동 검증하며 실제 손가락을 이용한 감각 검증은 별도다.

## 웹 스토어 확장 평가 — 배포 의존성 미포함

2026-09-30 Electron 43.4.1의 분리된 임시 프로필에서 다음 조합을 평가했다.

- electron-chrome-extensions 4.9.0: 프로필별 WebContentsView 탭 등록, MV3 worker,
  content-script/runtime 메시지, tabs.query, storage, popup 페이지 동작 확인.
- electron-chrome-web-store 0.13.0: Dark Reader 4.9.133 다운로드·설치 후
  실제 페이지에 darkreader 스타일 삽입 확인.
- 개발자 배포 라이선스: https://github.com/sponsors/samuelmaddock 의 월 $30 Patron 등급.
  조건: https://github.com/samuelmaddock/electron-browser-shell/blob/master/LICENSE-PATRON.md
- 평가용 패키지는 /tmp의 독립 프로젝트에만 설치했다. 앱 패키지·배포 의존성에는
  포함하지 않는다. 라이선스 확보가 확인되기 전에는 웹 스토어 전반 지원을 공개하지 않는다.
- 이번 평가 결과는 Chrome 확장 전체, 비밀번호 관리자의 native messaging,
  Chrome 계정 동기화나 Google 전용 API의 호환성을 보증하지 않는다.

라이선스 확보 후에는 프로필별 호환 계층 인스턴스를 탭 생성·선택·닫기 수명에 연결하고,
툴바 action/popup·context menu·권한 확인·업데이트 실패 복구를 포함한 배포 검증을 한다.
현재 제공하는 폴더 설치 기능도 프로필별로 독립 관리한다.
