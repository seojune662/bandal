# 메일 위젯 · 친구 대화 · 프레젠테이션

## 사용 흐름

- 메일: 설정에서 메일 위젯 추가 → Google 메일 연결 → 받은 메일/안 읽음/별표 → 본문 → 답장·보관·읽음 변경. `넓히기`는 앱 안의 큰 메일함이며 `전체 메일 열기`는 첨부파일 등 전체 기능용 웹메일이다.
- 친구: 왼쪽 대화 목록에서 친구 선택. 본인 메시지는 오른쪽, 상대방 메시지는 왼쪽. 알림 배지는 **안 읽은 대화 수 + 받은 친구 요청 수**다. 대화가 보이고 앱에 포커스가 있으며 최신 메시지 위치에 있을 때만 읽음 처리한다.
- PPTX: 자료 열기 → 펜·형광펜·텍스트·도형·사진으로 필기. 사진은 도구 모음 또는 붙여넣기로 추가한다.
- PPT/PPTX → 마크다운: `페이지 필기` → `만들고 나란히 열기`. 원본과 같은 페이지 수/비율의 빈 노트를 만들고 양방향 스크롤을 연결한다. 노트 파일 형식은 기존 PDF 페이지 필기와 호환된다.
- PDF 사본: 뷰어의 `PDF로 변환`, 자료 우클릭 메뉴, 다운로드 완료 알림 또는 다운로드 목록에서 실행. 뷰어에서는 `필기 포함` 여부를 고를 수 있다. 원본을 수정하지 않으며 동명 PDF가 있으면 새 이름으로 저장한다.

## Gmail 배포 설정 — 아직 계정 인증이 필요함

기존 Supabase Google 로그인과 별도의 **Desktop app** OAuth 클라이언트를 사용한다. 브라우저 쿠키를 읽거나 Gmail 웹페이지를 스크래핑하지 않는다.

1. Google Cloud 프로젝트에서 Gmail API를 활성화하고 OAuth 동의 화면을 구성한다.
2. Desktop app 유형 클라이언트를 만든다. 로컬 개발은 `.env.local`, 배포는 Actions secrets에 `MAIN_VITE_GMAIL_CLIENT_ID`를 설정한다. 네이티브 앱은 클라이언트 비밀을 안전하게 숨길 수 없는 public client이며 Bandal은 PKCE를 사용하므로 `client_secret`을 앱에 포함하지 않는다. 서버용 비밀키나 Supabase service-role 키도 넣으면 안 된다.
3. `gmail.modify` 권한은 제한된 Gmail 권한이다. 개발 단계에서는 등록된 테스트 사용자로 확인하고, 일반 공개 전에 Google의 요구 검증 및 학교 Workspace 정책을 확인한다.
4. 실제 계정에서 연결·갱신·해제·재연결·읽기·답장·보관을 확인한 뒤에만 Actions variable `MAIN_VITE_GMAIL_VERIFIED=true`를 설정한다. 이 값은 검증을 대신하지 않는다.

설정이 비어 있으면 위젯은 준비 중 안내와 전체 메일 링크를 제공한다. 로그인 완료로 가장하거나 브라우저 세션을 몰래 재사용하지 않는다. 인증 토큰은 메인 프로세스의 OS 암호화 저장소로만 보관하며 렌더러에는 계정 표시 정보만 전달한다. OAuth에는 loopback redirect, PKCE, state 검증, 취소/만료 처리가 포함되어 있다. 본문은 텍스트로 표시하며 원격 이미지·스크립트는 실행하지 않는다.

참고: [Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail 권한 범위](https://developers.google.com/workspace/gmail/api/auth/scopes).

## 구형 PPT 변환기

PPTX는 앱 내 OOXML worker로 처리한다. `.ppt`는 최초 사용 시 동의를 받고 LibreOffice를 사용자 데이터 폴더에 내려받아 PPTX로 정규화한다. Microsoft Office나 시스템 LibreOffice 설치는 필요 없다. macOS arm64/x64, Windows x64 패키지를 정의했다.

별도 Bandal 재서명 패키지 대신 **The Document Foundation의 서명된 원본 배포 패키지**를 사용한다. 릴리스 코드에 버전과 SHA-256을 고정하고 다운로드 후 해시와 플랫폼 서명을 검사한다. 버전 변경은 코드 리뷰와 앱 릴리스로만 가능하다. macOS에서는 읽기 전용 DMG 마운트에서 앱을 복사하고, Windows에서는 서명 검증 후 MSI를 개인 폴더에 추출한다. 전역 설치는 하지 않는다.

변환은 전용 임시 프로필·매크로 보안 설정으로 실행하고 원본은 업로드하지 않는다. 취소/시간 초과 시 자식 프로세스와 임시 파일을 정리한다. 원본 내용 해시를 기준으로 정규화 결과를 캐시하며 최대 512MB의 재생성 가능한 사본만 보관한다.

PDF는 슬라이드별 고해상도 이미지 + 검색용 텍스트 + 선택적인 필기를 합성한다. 페이지 크기는 EMU → PDF point로 변환한다. PowerPoint 애니메이션·동영상 재생은 정적 PDF로 옮겨지지 않는다. 복잡한 특수 글꼴·회전·효과의 완전한 PowerPoint 동일성을 보장하지 않는다.

참고: [LibreOffice 배포](https://download.documentfoundation.org/libreoffice/stable/), [명령행 변환](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html).

## DB 및 릴리스 순서

앱 배포 **전에** `supabase/migrations/20260909000000_direct_chat_unread.sql`을 적용한다. 새 `direct_chat_summaries()` RPC가 실제 수신 텍스트만 집계하므로 시스템 메시지·자기 메시지·삭제 메시지는 알림 수에 들어가지 않는다. 기존 읽음 커서를 무조건 최신으로 덮어쓰지 않는다. SQLite migration 31은 친구 목록 미리 보기 캐시 필드를 추가한다.

운영 배포 전 필수 확인:

- 두 실제 계정 간 새 메시지, 과거 메시지 읽기, 숨겨진 탭, 앱 비활성 상태에서 읽음/알림 동작.
- 별도 Google OAuth 설정과 실제 Gmail 작업. 테스트의 모의 인증 통과는 Google 검증 완료가 아니다.
- Windows 설치/취소/재시도와 서명된 macOS 앱에서 런타임 실행. macOS 로컬 결과가 Windows 검증을 대신하지 않는다.

## 검증 명령

```sh
pnpm typecheck
pnpm deadcode
pnpm test
pnpm build
pnpm exec playwright test -c e2e/playwright.config.ts fileViewers.spec.ts widgets.spec.ts
BANDAL_TEST_POSTGRES=1 pnpm exec vitest run tests/main/group/directChatSql.test.ts
BANDAL_TEST_PPT_RUNTIME=1 pnpm exec playwright test -c e2e/playwright.config.ts fileViewers.spec.ts -g 'legacy runtime'
```

PostgreSQL 검사는 별도 임시 클러스터와 Unix 소켓만 사용한다. PPT 런타임 검사는 수백 MB를 내려받는 opt-in 검사이고, 사용자의 앱/자료 대신 일회용 Electron 프로필에 설치한다.
