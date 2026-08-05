# 대학 학사 웹서비스 카탈로그 (University Service Presets)

> **목적** — 온보딩에서 학교를 고르면 좌측 사이드바에 그 학교의 학사 서비스가 원클릭 바로가기로 뜬다.
> 링크는 Bandal 내장 브라우저(`persist:browsing` 파티션)에서 열리고, 로그인 세션은 파티션에 남는다.
> **비밀번호는 저장하지 않는다.** 과목별 링크(예: 특정 eTL 강의실)는 각 과목 아래에 핀으로 붙는다.
>
> 조사일: **2026-08-05** · 조사자: research agent (Bandal)

---

## TL;DR (엔지니어용 5줄)

1. **서울대 eTL은 더 이상 Moodle이 아니다.** `etl.snu.ac.kr` 은 Xinics 강좌 포털이고,
   실제 강의실은 **Canvas** 기반 `myetl.snu.ac.kr` 다. 과목 딥링크는 `https://myetl.snu.ac.kr/courses/{정수id}`.
2. **국내 LMS는 Canvas / Moodle 양강 구도** — 조사한 18개교 중 Canvas 7 + Moodle 8.
   **딥링크 어댑터 두 개로 15개교를 덮는다.** Canvas 진영은 로그인 체인까지 동일하다.
3. **UA에서 `Chrome/<버전>` 토큰을 절대 지우지 마라.** 연세대 포털·KAIST 수강신청·서강대 SAINT가
   미분류 UA를 fail-closed로 막는다. `Electron/` 과 앱 이름만 제거하라.
4. **웹메일은 기본값 외부 브라우저.** Google(서울대·성균관·한양·이화)·Microsoft(중앙대·건국대)가
   임베디드 웹뷰 로그인을 정책적으로 차단한다.
5. `X-Frame-Options` 는 **우리 문제가 아니다** — `<webview>` 는 최상위 프레임이다. 대신 **절대 `<iframe>` 으로 바꾸지 마라.**

---

## 0. 이 문서를 읽는 법

### 신뢰도 표기

| 표기 | 뜻 |
|---|---|
| ✅ | 이번 조사에서 **직접 HTTP 요청**으로 확인 (상태코드/최종 리다이렉트/`<title>` 관측) |
| ⚠️ | 호스트·플랫폼은 확인했으나 **정확한 경로나 동작은 미확인** (로그인 필요 등) |
| ❓ | **미확인 / 추정.** 실제 계정으로 검증 전에는 프리셋에 넣지 말 것 |
| ❌ | 확인 결과 **틀렸거나 죽은 URL** — 넣지 말 것 |

### 조사 방법과 한계 (정직하게)

- 모든 URL은 데스크톱 Chrome UA로 `curl -L` 요청해 상태코드·최종 URL·`<title>`·프레임 헤더를 관측했다.
- **계정이 없으므로 로그인 이후 동작은 전부 미검증이다.** 한국 대학의 수강신청·학사정보 시스템은
  키보드보안(AhnLab/nProtect/TouchEn/Wizvera) 같은 플러그인을 **인증 이후에** 띄우는 경우가 많다.
  어떤 로그인 페이지에서도 해당 벤더 문자열을 찾지 못했지만, **"깨끗하다"는 증거가 아니라 "확인 못 했다"** 로 읽어야 한다.
- 조사는 **미국 IP** 에서 수행했다. GeoIP 분기(연세대 홈페이지)나 국내망 전용 호스트(KAIST `iam2`)는
  한국에서 다르게 보일 수 있다.
- 2FA/OTP 강제 여부는 **전 대학 미확인**이다.

---

## 1. 서울대학교 (SNU) — 기준 대학, 가장 상세

`id: snu` · `nameKo: 서울대학교` · `nameEn: Seoul National University` · `domain: snu.ac.kr`

### 1.1 핵심 서비스

| 종류 | 이름 | URL | 상태 | 비고 |
|---|---|---|---|---|
| `portal` | 마이스누 (mySNU) | `https://my.snu.ac.kr/` | ✅ 200 → `/index.jsp` → 302 `/login.jsp`, title `서울대학교 포털 로그인` | 학사정보 · 성적 · 증명서 · 등록 전부 여기 안에 있음 |
| `lms` | **New eTL** (강좌 포털) | `https://etl.snu.ac.kr/` | ✅ 200, title `서울대학교 New eTL` | **Xinics(자이닉스)** 기반 강좌 카탈로그 + SSO 게이트웨이 |
| `lms` | **내 강의실** (myeTL) | `https://myetl.snu.ac.kr/login` | ✅ 302 → `etl.snu.ac.kr/xn-sso/gw.php` | **실제 강의실. Instructure Canvas + Xinics LearningX**<br>⚠️ 루트(`/`)를 링크하지 말 것 — 미로그인 시 `{"status":"인증되지 않음"}` **JSON 원문**이 그대로 보인다. `/login` 이 SSO로 태워준다 |
| `lms` | 구 eTL (과거 강좌 보관) | `https://oldetl.snu.ac.kr/` | ✅ 303 → `/login/index.php` | **Moodle** (유비온 `local/ubion`). 과거 학기 자료 조회용 |
| `registration` | 수강신청 | `https://sugang.snu.ac.kr/` | ✅ 200, title `서울대학교 수강신청 프로그램` | 진입점 `/sugang/co/co010.action`. **NetFUNNEL 대기열** 사용 |
| `library` | 중앙도서관 | `https://lib.snu.ac.kr/` | ✅ 200, title `서울대학교 중앙도서관` | |
| `library` | 자료검색 (Primo) | `https://lib.snu.ac.kr/find/` | ✅ → `primoapac01.hosted.exlibrisgroup.com/primo-explore/search?vid=82SNU` | Ex Libris Primo |
| `library` | 마이 라이브러리 | `https://lib.snu.ac.kr/mylibrary/` | ✅ | 대출·연장·예약 |
| `mail` | **학생 메일 = Google Workspace** | `https://mail.google.com/` | ✅ 공식 안내로 확인 | `@snu.ac.kr` 계정으로 Gmail 로그인. **교직원만 Dooray** |
| `mail` | 교직원 메일 (Dooray) | `https://snu.gov-dooray.com/` | ✅ 200 → `gov-iam.toast.com/login` | `snu.ac.kr` MX = `aspmx1.gov-dooray.com` 로 교차 확인 |
| `homepage` | 학교 홈페이지 | `https://www.snu.ac.kr/` | ✅ 200 | |

### 1.2 부가 서비스 (SNU 전용, 프리셋 2군으로 두기 좋음)

| 이름 | URL | 상태 |
|---|---|---|
| 스누지니 (강의/전공 추천) | `https://snugenie.snu.ac.kr/` | ✅ 200, title `서울대학교 - 스누지니` |
| SNU 비교과 | `https://extra.snu.ac.kr/main.html` | ✅ 200, title `SNU비교과` |
| 전공설계지원센터 | `https://advising.snu.ac.kr/` | ✅ 200 |
| 교양교육과정 | `https://snuc.snu.ac.kr/` | ✅ 200 |
| 학사일정 | `https://www.snu.ac.kr/academics/resources/calendar` | ✅ 200 |
| 생협 식단 | `https://snuco.snu.ac.kr/foodmenu/` | ✅ 200 |
| 캠퍼스 지도 | `https://map.snu.ac.kr/web/main.action` | ✅ 200 |
| 스누새 (학내 커뮤니티) | `https://bird.snu.ac.kr/` | ✅ 200 |
| IT 서비스 데스크 | `https://itsm.snu.ac.kr/` | ✅ 200 |
| 정보화본부 | `https://ist.snu.ac.kr/` | ✅ 200 |
| 학외 접속(프록시) 안내 | `https://lib.snu.ac.kr/using/proxy/` | ✅ |

### 1.3 넣지 말아야 할 URL ❌

| URL | 이유 |
|---|---|
| `https://portal.snu.ac.kr/` | ✅ 200이지만 내용은 **"미사용 도메인 회수 조치 안내"**. 폐기된 도메인 |
| `https://mail.snu.ac.kr/` | ✅ **DNS NXDOMAIN** (8.8.8.8 기준). 검색엔진에 남은 유령 URL |
| `https://myle.snu.ac.kr/` | ✅ NXDOMAIN. 존재하지 않음 |
| `https://sso.snu.ac.kr/` | ✅ NXDOMAIN. SSO 호스트는 **`nsso.snu.ac.kr`** |
| `https://etl.snu.ac.kr/course/view.php?id=…` | ✅ 404. New eTL은 **Moodle이 아니다** |

### 1.4 SNU SSO / 인증

- 통합인증 호스트: **`https://nsso.snu.ac.kr/`** ✅ (루트는 403이지만 `/sso/usr/self/regist` 는 200).
  UA 스니핑이 아니라 단순히 루트에 인덱스가 없는 것 — Electron UA로도 동일하게 동작함을 확인했다.
- eTL → Canvas 로그인 체인 (✅ 실측):
  `https://myetl.snu.ac.kr/login` → 302 → `https://etl.snu.ac.kr/xn-sso/gw.php?from=web_redirect&login_type=sso&cvs_lgn=true&callback_url=https%3A%2F%2Fmyetl.snu.ac.kr%2Flearningx%2Flogin`
  → Xinics SSO 게이트웨이 → SNU 통합인증.
  **`etl.snu.ac.kr` 과 `myetl.snu.ac.kr` 쿠키가 같은 파티션에 있어야 원클릭이 성립한다.**
- 증명서 발급은 **별도 호스트 없이 mySNU 안**(수업·학업 → 증명서/확인서)에서 처리된다.
  다른 학교(고려대 `kucert`, POSTECH `cert` 등)와 달리 SNU는 별도 증명발급 사이트를 쓰지 않는다.

---

## 2. 서울권 주요 사립대

### 2.1 연세대학교 (Yonsei) — `id: yonsei` · `domain: yonsei.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 연세포탈 (학사정보 포함) | `https://portal.yonsei.ac.kr/portal/MainCtr/index.do` | ✅ 200 |
| `lms` | LearnUs | `https://ys.learnus.org/` | ✅ 200, title `LearnUs YONSEI` |
| `library` | 학술정보원 | `https://library.yonsei.ac.kr/` | ✅ 200 |
| `mail` | 웹메일 | `https://mail.yonsei.ac.kr/` | ✅ 301 → `/mail` |
| `registration` | 수강신청 | **별도 호스트 없음 — 포털 내부** | ✅ `sugang.yonsei.ac.kr` = NXDOMAIN ❌ |
| `homepage` | 홈페이지 | `https://www.yonsei.ac.kr/sc/index.do` | ✅ (루트는 GeoIP JS 분기 → `/sc/` 직접 링크 권장) |

- **LMS: Moodle / Coursemos v2 (유비온)** — `theme_coursemosv2`, `mod/ubboard`, `local/ubonline` 확인.
- **과목 URL: `https://ys.learnus.org/course/view.php?id=NNNNN`** ✅ (`?id=1` → 303 → `/login/index.php`).
- 🔴 **UA 스니핑 확정.** `portal.yonsei.ac.kr/js/browserCheck.js` 의 `checkBrowser()` 는
  `default: returnVal = false` — 분류 못 하는 UA는 전부 `/browsersupport.html` 로 튕긴다.
  **UA에 `Chrome/<버전>` 토큰이 반드시 남아 있어야 한다.**
- ⚠️ `library.yonsei.ac.kr` 은 TLS 중간 인증서 체인이 불완전(`verify error 20/21`). Chromium은 AIA로 복구하지만 관찰 대상.
- ❓ 포털 SSO가 LearnUs로 전파되는지는 미확인.

### 2.2 고려대학교 (Korea Univ.) — `id: korea` · `domain: korea.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | KUPID 포털 | `https://portal.korea.ac.kr/` | ✅ 200 (JS 스텁 → `index.jsp`) |
| `portal` | 학사정보 AMS | `https://ams.korea.ac.kr/` | ⚠️ 200이지만 JS 스텁. SSO CSP 목록·수강신청 JS로 교차 확인 |
| `lms` | LMS (프론트) | `https://lms.korea.ac.kr/` | ✅ 200, title `고려대학교 LMS`, LearningX 5.51.1 |
| `lms` | Canvas (강의실) | `https://canvas.korea.ac.kr/` | ✅ 302 → `lms.korea.ac.kr/xn-sso/gw.php` |
| `library` | 도서관 | `https://library.korea.ac.kr/` | ✅ 200 |
| `mail` | 웹메일 (하이웍스) | `https://mail.korea.ac.kr/` | ✅ 200, title `하이웍스 오피스` |
| `registration` | 수강신청 | `https://sugang.korea.ac.kr/` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.korea.ac.kr/sites/ko/index.do` | ✅ 200 |
| — | 인터넷증명발급 | `https://kucert.korea.ac.kr/` | ⚠️ **플러그인 설치 필요 → 외부 브라우저** |

- **LMS: Canvas + Xinics LearningX.** 과목 URL **`https://canvas.korea.ac.kr/courses/NNNNN`** ⚠️(플랫폼 확정, 인증 경로 미확인).
- 🔑 **SSO 호스트 `https://sso.korea.ac.kr/`** ✅ — CSP `frame-ancestors` 에 `ams, amsa, amsnew, gms, gmsa, gmsnew, gmsnext, rep, library, librsv, libs, medlib, gw, mgw, rms` 전체 목록이 노출된다. 4개 대학 중 SSO 증거가 가장 강함.
- ❌ `kupis.korea.ac.kr`, `blackboard.korea.ac.kr` = NXDOMAIN. 고려대는 더 이상 Blackboard가 아니다.

### 2.3 성균관대학교 (SKKU) — `id: skku` · `domain: skku.edu`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 킹고포털 | `https://portal.skku.edu/` → `https://login.skku.edu/` | ⚠️ 루트가 **깨진 JSP 스텁**(`<spro:message …/>` 태그가 그대로 렌더). 최종 title `성균관대학교 로그인` |
| `lms` | i-Campus (프론트) | `https://icampus.skku.edu/` | ✅ 200, title `성균관대학교 아이캠퍼스`, LearningX 5.51.4 |
| `lms` | Canvas (강의실) | `https://canvas.skku.edu/` | ✅ 401; `/login` → `icampus.skku.edu/xn-sso/login.php` |
| `library` | 도서관 | `https://lib.skku.edu/` | ✅ 200 |
| `mail` | **Google Workspace** | `https://mail.google.com/` | ✅ `mail.skku.edu`·`webmail.skku.edu` = NXDOMAIN, 공식 안내로 확인 |
| `registration` | 수강신청 | `https://sugang.skku.edu/skku/` | ✅ 302 → 200 |
| `homepage` | 홈페이지 | `https://www.skku.edu/skku/index.do` | ✅ 302 → 200 (`XFO: DENY`) |

- **LMS: Canvas + Xinics LearningX.** 과목 URL **`https://canvas.skku.edu/courses/NNNNN`** ❓(401이라 미검증, 스택으로부터 추론).
- 🔑 SSO 호스트 **`https://login.skku.edu/`**.
- ⚠️ i-Campus가 **EverLec**(Xinics 강의녹화, Windows 전용 `.exe`)를 참조한다. macOS/Linux에서 일부 녹화강의 재생이 막힐 수 있다.
- ❌ `gls.skku.edu` = NXDOMAIN. GLS는 킹고포털 내부 메뉴이지 독립 호스트가 아니다.

### 2.4 한양대학교 (Hanyang) — `id: hanyang` · `domain: hanyang.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | HY-in 포털 | `https://portal.hanyang.ac.kr/sso/lgin.do` | ✅ 200, title `한양대학교 포털` |
| `lms` | Canvas (강의실) | `https://learning.hanyang.ac.kr/` | ✅ 401 JSON + `x-canvas-meta` |
| `lms` | LMS 프론트 | `https://lms.hanyang.ac.kr/` → `https://hy-mooc.hanyang.ac.kr/lms` | ✅ 302 → 200 |
| `library` | 백남학술정보관 (서울) | `https://lib.hanyang.ac.kr/` | ✅ 200 |
| `library` | ERICA학술정보관 | `https://information.hanyang.ac.kr/` | ✅ 200 |
| `mail` | **Google Workspace** | `https://mail.google.com/` (안내: `https://gsuite.hanyang.ac.kr/`) | ✅ `mail.hanyang.ac.kr` = NXDOMAIN |
| `registration` | 수강신청 | `https://portal.hanyang.ac.kr/sugang/sulg.do` | ✅ (`sugang.hanyang.ac.kr` 은 여기로 리다이렉트되나 TLS 핸드셰이크가 불안정 — 포털 경로 직링크 권장) |
| `homepage` | 홈페이지 (서울) | `https://www.hanyang.ac.kr/home` | ✅ 200 |
| `homepage` | 홈페이지 (ERICA) | `https://www.hanyang.ac.kr/erica` | ✅ 200 |

- **LMS: Canvas + Xinics LearningX — Blackboard 아님.** Blackboard 경로(`/webapps/login/`, `/ultra`)는 전부 404 ✅.
- **과목 URL: `https://learning.hanyang.ac.kr/courses/NNNNN`** ✅ (`/courses/1` → 302 → `/login`).
- 서울/ERICA는 **포털·LMS를 공유**하고 도서관만 다르다 → 캠퍼스 분기는 `library` 하나만 있으면 된다.
- ❌ 함정 두 개: `learn.hanyang.ac.kr` 은 LMS가 아니라 Liferay 사이트로 302된다. `hy-in.hanyang.ac.kr` = NXDOMAIN(브랜드명일 뿐).

### 2.5 중앙대학교 (Chung-Ang) — `id: cau` · `domain: cau.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 중앙대 포탈 | `https://mportal.cau.ac.kr/` | ✅ `portal.cau.ac.kr` → 301 → `mportal`. 루트는 SPA(빈 body) |
| `lms` | e-Class / CAU-ON | `https://eclass3.cau.ac.kr/` | ✅ `/login` → 302 → `canvas.cau.ac.kr/xn-sso/gw.php` |
| `lms` | Canvas 코어 | `https://canvas.cau.ac.kr/` | ✅ 200, title `중앙대학교 CAU-ON` |
| `library` | 학술정보원 (서울) | `https://library.cau.ac.kr/` | ✅ 200 |
| `library` | 학술정보원 (다빈치) | `https://alibrary.cau.ac.kr/` | ✅ 200 |
| `mail` | **Microsoft 365 (OWA)** | `https://mail.cau.ac.kr/` → `outlook.office.com/owa/?realm=cau.ac.kr` | ✅ 302 |
| `registration` | 수강신청 | `https://sugang.cau.ac.kr/` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.cau.ac.kr/` | ✅ 200 |

- **LMS: Canvas + Xinics LearningX.** 과목 URL **`https://eclass3.cau.ac.kr/courses/NNNNN`** ✅ — 공개 강좌 `/courses/6843` 이 **로그인 없이 실제로 렌더**되어 형태가 실증됐다. (전 대학 통틀어 가장 강한 딥링크 증거)
- 🔑 SSO 호스트 **`https://sso4.cau.ac.kr/sso/ssoService.do`** ✅ (다른 학내 서비스가 여기로 302되는 것으로 확인).

### 2.6 경희대학교 (Kyung Hee) — `id: khu` · `domain: khu.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 포털 | `https://portal.khu.ac.kr/` | ✅ 200 |
| `portal` | 학사정보 인포21 | `https://info21.khu.ac.kr/` | ⚠️ 200이나 JS 렌더. 로그인 경로 `/com/LoginCtr/login.do?sso=ok` |
| `lms` | e-Campus (프론트) | `https://e-campus.khu.ac.kr/` | ✅ 200 |
| `lms` | Canvas 코어 | `https://khcanvas.khu.ac.kr/` | ✅ `/login` → 302 → `e-campus.khu.ac.kr/xn-sso/gw.php` |
| `library` | 중앙도서관 | `https://lib.khu.ac.kr/` | ✅ 200 |
| `mail` | 웹메일 (자체) | `https://mail.khu.ac.kr/` | ✅ 200, title `경희대학교 웹메일` |
| `registration` | 수강신청 | `https://sugang.khu.ac.kr/` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.khu.ac.kr/` | ✅ 200 |

- **LMS: Canvas + Xinics LearningX.** 과목 URL **`https://khcanvas.khu.ac.kr/courses/NNNNN`** ⚠️(체인은 CAU와 동일, 실제 id 미검증).
- 🔑 SSO: 인포21이 신원 마스터. e-Campus 로그인 페이지에 *"Info21의 통합 아이디 또는 학번으로 로그인 가능"* 명시.
- 경희대 공식 안내가 **Chrome 최적화**를 명시 → Chrome UA 유지 필요.

### 2.7 서강대학교 (Sogang) — `id: sogang` · `domain: sogang.ac.kr` — 🔴 **위험도 최고**

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | SAINT | `https://saint.sogang.ac.kr/irj/portal` | 🔴 200이지만 **본문이 에러**(아래 참조) |
| `lms` | 사이버캠퍼스 | `https://cyber.sogang.ac.kr/ilos/main/main_form.acl` | ✅ 200, title `서강대학교 Cyber Campus System` |
| `library` | 로욜라도서관 | `https://library.sogang.ac.kr/` | ✅ 200 |
| `mail` | 웹메일 | `https://mail.sogang.ac.kr/` | ⚠️ 200이나 `<title>` 비어 있는 **frameset** |
| `registration` | 수강신청 | `https://sis109.sogang.ac.kr/zu4a/zcmuik101` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.sogang.ac.kr/` | ✅ 200 |

- **LMS: iLOS** (`/ilos/` + `.acl` 엔드포인트). Moodle/Blackboard/Canvas 아님. 벤더사명 ❓.
- **과목 URL: `https://cyber.sogang.ac.kr/ilos/st/course/submain_form.acl?…`** ❓ — 경로는 존재하나 **파라미터명 미확인**.
  다른 iLOS 사이트는 `KJKEY=` 를 쓴다(건국대에서 실증). 서강대는 실계정 검증 전 하드코딩 금지.
- 🔴 **SAINT는 SAP NetWeaver Portal이고 UA를 가린다.** 응답 본문이 로그인 폼이 아니라
  `"iView를 열 수 없습니다. iView가 브라우저, 운영 체제 또는 장치와 호환되지 않습니다."` 였다.
  Electron 기본 UA로는 그대로 막힐 가능성이 크다 → **Chrome UA 강제 + 실기기 테스트 필수**, 실패 시 외부 브라우저 폴백.
- 🟠 수강신청 시스템이 *"SAINT와 동시 로그인 시 중복 로그인 문제"* 를 경고한다.
  → **서강대만은 수강신청을 별도 파티션으로 격리**하는 편이 안전하다.
- ❌ `splus.sogang.ac.kr` 은 LMS가 아니라 **비교과통합관리시스템**이다(홈페이지 링크 위치 때문에 헷갈리기 쉬움).

### 2.8 이화여자대학교 (Ewha) — `id: ewha` · `domain: ewha.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 이화포탈 | `https://portal.ewha.ac.kr/` | ⚠️ 200이지만 본문이 "페이지를 찾을 수 없습니다" — **정확한 진입점 미확인** |
| `portal` | 유레카 통합행정 | `https://eureka.ewha.ac.kr/` | ⚠️ 200, JS 렌더(빈 body) |
| `lms` | 사이버캠퍼스 | `https://cyber.ewha.ac.kr/` | ✅ 200, title `Ewha CyberCampus` |
| `library` | 중앙도서관 | `https://lib.ewha.ac.kr/` | ⚠️ **403** (봇/UA 필터). 호스트는 맞음 |
| `mail` | **Google Workspace** | `https://mail.google.com/` | ✅ 공식 안내 명시 |
| `registration` | 수강신청 | `https://sugang.ewha.ac.kr/` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.ewha.ac.kr/` | ✅ 200 |

- **LMS: Moodle / Coursemos** (`theme_coursemosv2`, `/mod/ubboard/view.php`).
  과목 URL **`https://cyber.ewha.ac.kr/course/view.php?id=NNNNN`** ⚠️(Moodle 내부 확인, 실제 강의실 미렌더).
- 🔑 SSO: **유레카 통합로그인**. 사이버캠퍼스 로그인 버튼이 literally "유레카 로그인".
- 🔴 **`www.ewhain.net` / `ewhain.net` 은 인증서 만료 상태** — Chromium이 하드 인터스티셜로 막는다.
  이화인 바로가기를 넣지 말 것. **인증서 검증을 끄는 우회는 절대 금지.**
- ❌ `mail.ewha.ac.kr` 은 title이 `하이웍스 오피스` 로 나와 공식 Gmail 안내와 불일치한다. **웹메일 바로가기로 쓰지 말 것.**

---

## 3. 이공계 특성화 · 지방 거점 국립대

### 3.1 KAIST — `id: kaist` · `domain: kaist.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | KAIST 포털 | `https://portal.kaist.ac.kr/` | ✅ 302×4 → `/common/login/login.do` |
| `lms` | KLMS | `https://klms.kaist.ac.kr/` | ✅ 302 → `/login/index.php` → `/login/ssologin.php` |
| `library` | 도서관 | `https://library.kaist.ac.kr/` | ✅ 302 → `/main.do` |
| `mail` | **Dooray** | `https://mail.kaist.ac.kr/` → `kaist.gov-dooray.com/mail` | ✅ 302 → SAML → `sso.kaist.ac.kr` |
| `registration` | 수강신청 | `https://sugang.kaist.ac.kr/` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.kaist.ac.kr/kr/` | ✅ 200 |

- **LMS: Moodle** (테마 `theme_oklass39`). ✅ `/course/view.php?id=1` → 303 → `/login/index.php`.
  **과목 URL: `https://klms.kaist.ac.kr/course/view.php?id=NNNNN`** ✅
- 🔑 SSO는 **`sso.kaist.ac.kr`**(SAML). `iam2.kaist.ac.kr` 는 DNS는 잡히지만(143.248.105.149)
  **국외에서 443 포트가 안 열린다** — 국내망 전용. 프리셋에는 `sso.kaist.ac.kr` 를 쓸 것.
- 🔴 **`sugang.kaist.ac.kr` UA 스니핑.** `/js/browserCheck.js` 가 `default: returnVal = false` 로 끝나고,
  미분류 UA에서는 `type.toUpperCase()` 가 `TypeError` 를 던져 빈 `WELCOME` 페이지가 남는다.
- 🔴 `library.kaist.ac.kr` 은 `X-Frame-Options: DENY` (iframe 불가 / webview는 무관).
- 메일이 Dooray라 **학사 SSO와 별개 세션**이다.

### 3.2 POSTECH — `id: postech` · `domain: postech.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | POVIS | `https://povis.postech.ac.kr/` | ✅ 302×3 → SAML → `sso.postech.ac.kr/sso/usr/login/view` |
| `portal` | PODIUM 통합포털 | `https://podium.postech.ac.kr/` | ✅ 302 → `/common/login/login.do` |
| `lms` | PLMS | `https://plms.postech.ac.kr/` | ✅ 302 → `/login/index.php`, title `POSTECH LMS` |
| `library` | 박태준학술정보관 | `https://library.postech.ac.kr/` | ✅ 200 |
| `mail` | Exchange/OWA + ADFS | `https://mail.postech.ac.kr/` | ✅ 302 → `mail-login.postech.ac.kr/adfs/ls?...` |
| `registration` | 수강신청 | **POVIS 내부** | ✅ `sugang/course/reg.postech.ac.kr` 전부 NXDOMAIN ❌ |
| `homepage` | 홈페이지 | `https://www.postech.ac.kr/kor/index.do` | ✅ 200 |
| — | 증명발급 | `http://cert.postech.ac.kr/` | ⚠️ **문서보안 플러그인 필요 → 외부 브라우저** |

- **LMS: Moodle + Coursemos (Xinics).** **과목 URL: `https://plms.postech.ac.kr/course/view.php?id=NNNNN`** ✅
- ❓ POVIS와 PODIUM이 둘 다 살아 있다. **학생이 어디로 가야 하는지 외부에서 판단 불가** — 둘 다 노출하거나 실계정 확인.
- ❌ 널리 인용되는 `povis.postech.ac.kr/irj/portal` (SAP 경로)은 **지금 404**다.
- ⚠️ PLMS 로그인 페이지의 `지원하지 않는` 문자열은 **Video.js 한국어 로케일**이지 브라우저 차단이 아니다(오탐 주의).

### 3.3 건국대학교 (Konkuk) — `id: konkuk` · `domain: konkuk.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 위인전(WeIn) 포털 | `https://wein.konkuk.ac.kr/` | ✅ 200 |
| `portal` | 학사정보시스템 KUIS | `https://kuis.konkuk.ac.kr/` | ✅ 200, title `건국대학교 학사정보시스템` |
| `lms` | eCampus | `https://ecampus.konkuk.ac.kr/ilos/index.acl` | ✅ 200 |
| `library` | 상허기념도서관 | `https://library.konkuk.ac.kr/` | ✅ 200 |
| `mail` | **Office 365 + ADFS** | `https://kumail.konkuk.ac.kr/` | ✅ 200 → `/adfs/ls/?...MicrosoftOnline` |
| `registration` | 수강신청 | `https://sugang.konkuk.ac.kr/sugang/index.jsp` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.konkuk.ac.kr/konkuk/index.do` | ✅ 302×5 → 200 |

- **LMS: iLOS 계열** (`.acl`) + Xinics Commons 연동. **과목 URL: `https://ecampus.konkuk.ac.kr/ilos/st/course/submain_form.acl?KJKEY=<key>`** ⚠️
  — 경로는 200으로 실증, 파라미터명 `KJKEY` 도 소스에서 확인. **숫자 id가 아니라 문자열 키**다.
- 🔑 SSO **`sso.konkuk.ac.kr/svc/tk/Auth.do`** ✅ (홈페이지 방문 때마다 이 티켓 체인을 탄다).
- ❌ **`portal.konkuk.ac.kr` 은 HTTP 500 (IIS 8.5) — 죽었다.** 절대 넣지 말 것.
- ⚠️ 홈페이지 진입이 **5홉 리다이렉트 + 중간에 `http://` 다운그레이드**를 포함한다.
  리다이렉트 상한을 넉넉히(≥10) 두고 혼합 스킴 홉을 막지 말 것.

### 3.4 동국대학교 (Dongguk) — `id: dongguk` · `domain: dongguk.edu`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | uDRIMS 2.0 | `https://nportal.dongguk.edu/comm/login/user/login.do` | ✅ 200, title `동국대학교-uDRIMS 2.0` |
| `lms` | 이클래스 | `https://eclass.dongguk.edu/` | ✅ 200, title `동국대학교 이클래스` |
| `library` | 중앙도서관 | `https://lib.dongguk.edu/` | ✅ 200 |
| `mail` | CloudMail | `https://mail.dongguk.edu/` | ✅ 200 (`CLOUDMAIL-JSESSIONID`) |
| `registration` | 수강신청 | `https://sugang.dongguk.edu/` | ✅ 200 |
| `homepage` | 홈페이지 | `https://www.dongguk.edu/main` | ✅ 200 |

- **LMS: Moodle + Coursemos (Xinics).** **과목 URL: `https://eclass.dongguk.edu/course/view.php?id=NNNNN`** ✅
- 🔴 **`portal.dongguk.edu` 는 진짜 frame-buster다** — 본문 전체가
  `top.location.replace("https://nportal.dongguk.edu/comm/login/user/login.do")`.
  `<iframe>` 이면 호스트 창을 탈취당한다. **webview에서는 무해**하지만, 어차피 `nportal` 직링크를 쓰는 게 맞다.
  (`/comm/login/base/login.do` 는 **관리자용**이다 — 학생은 `/user/`.)
- ⚠️ 동국대는 `.edu` 와 `.ac.kr` 을 모두 서빙한다. **세션 파티션 안정성을 위해 하나로 통일**할 것.

### 3.5 부산대학교 (PNU) — `id: pusan` · `domain: pusan.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 학생지원시스템 (원스톱) | `https://onestop.pusan.ac.kr/` | ✅ 200 → `/login`, title `부산대학교 - 학생지원시스템` |
| `portal` | 교육정보시스템 | `https://one.pusan.ac.kr/` | ✅ 200, title `부산대학교 교육정보시스템` (WebSquare5) |
| `lms` | **PLATO** | `https://plato.pusan.ac.kr/` | ✅ 200, title `부산대학교 스마트 교육플랫폼 PLATO` |
| `library` | 도서관 | `https://lib.pusan.ac.kr/` | ✅ 200 |
| `mail` | 웹메일 | `https://mail.pusan.ac.kr/mail` | ✅ 200 (Next.js 그룹웨어 SPA, Naver Cloud) |
| `registration` | 수강신청 | `https://sugang.pusan.ac.kr/` | ✅ 200 → `/login`, title `부산대학교 - 수강신청시스템` |
| `homepage` | 홈페이지 | `https://www.pusan.ac.kr/kor/` | ✅ (루트는 `<script>location.href="/kor"` 스텁 — **`/kor` 을 직접 링크**) |
| — | 통합로그인 (SSO) | `https://login.pusan.ac.kr/onestop/loginPage` | ✅ 200, title `부산대학교 통합로그인`, `X-Frame-Options: DENY` |

- **LMS: Moodle + Coursemos (Xinics/유비온)** — 직접 확인 ✅: 소스에 `M.cfg`·`coursemos`·`ubion` 존재,
  `/course/view.php?id=1` → **303 → `/login/index.php` → `/login.php`**.
- **과목 URL: `https://plato.pusan.ac.kr/course/view.php?id=NNNNN`** ✅
- 🟢 **보안 플러그인 없음, UA 스니핑 없음.** Chrome UA와 Electron UA로 받은 바이트 수가 완전히 동일
  (login 32140/32140, plato 33652/33652, sugang 29308/29308). 18개교 중 **가장 안전한 편**.
- 🟠 **2FA가 실재한다.** OTP/생체인증/모바일 ID + 최초 이용 시 이메일 2차 인증 필수. 온보딩에서 기대치를 낮춰 둘 것.
- 수강신청 안내에 *"Safari에는 제약이 있으니 Chrome 또는 Edge"* — Chromium이면 문제없다.
- ❌ NXDOMAIN: `haksa.pusan.ac.kr`, `portal.pusan.ac.kr`, `lms.pusan.ac.kr`. (`plms.pusan.ac.kr` 는 303 → plato 로 살아 있는 레거시 별칭)

### 3.6 경북대학교 (KNU) — `id: knu` · `domain: knu.ac.kr`

| 종류 | 이름 | URL | 상태 |
|---|---|---|---|
| `portal` | 통합포털 | `https://on.knu.ac.kr/` | ✅ 200 → `/sso/business.jsp` |
| `portal` | 통합정보시스템 KNUIN (학사) | `https://knuin.knu.ac.kr/knuin/index.knu` | ⚠️ 루트 **500**. `/login.knu` → `appfn.knu.ac.kr`. DNS는 KNU 대역(155.230.130.79) |
| `lms` | LMS 프론트 | `https://lms.knu.ac.kr/` → `https://lms1.knu.ac.kr/` | ✅ 200, title `경북대학교 학습관리시스템` |
| `lms` | **Canvas (강의실)** | `https://canvas.knu.ac.kr/` | ✅ 401 + **`X-Canvas-Meta`** 헤더 |
| `library` | **도서관** | `https://kudos.knu.ac.kr/` | ✅ 200, title `경북대학교 도서관` |
| `mail` | 웹메일 | `https://mail.knu.ac.kr/mail` | ✅ 200 (부산대와 **동일한 Next.js 그룹웨어 빌드**) |
| `registration` | 수강신청 | `https://sugang.knu.ac.kr/` | ⚠️ `/login.knu` 존재하나 미인증 시 **500** |
| `homepage` | 홈페이지 | `https://www.knu.ac.kr/wbbs/wbbs/main/main.action` | ✅ 200 |
| — | SSO (ISign+) | `https://knusso.knu.ac.kr/` | ✅ 200 → `/authentication/multi/multiLogin.html`, title `ISign+` |

- **LMS: Instructure Canvas** ✅ — `canvas.knu.ac.kr` 응답 헤더에 **`X-Canvas-Meta`** 가 실려 있다(가장 강한 증거).
  `lms1.knu.ac.kr` 은 **프론트/SSO 게이트웨이**(`/xn-sso/gw.php`)이지 강의실이 아니다.
  > ⚠️ 블로그에 흔한 "경북대 LMS = LearningX(유비온)" 서술은 **틀렸다.** 코어는 Canvas다.
- **과목 URL: `https://canvas.knu.ac.kr/courses/NNNNN`** ✅ — 직접 확인:
  `/courses/5000` → **302 → `/login`**(존재+인증필요), `/courses/1`·`/courses/99999` → 404(미존재).
  `lms1.knu.ac.kr/courses/…` 는 404 — **라우트는 `canvas` 호스트에만 있다.**
- 🔴 **SSO 체인이 전부 JS + form POST 다.** `on.knu.ac.kr/sso/business.jsp` 의 자동 제출 폼 →
  `knusso.knu.ac.kr`(ISign+) → `appfn.knu.ac.kr/login.knu`.
  **HTTP 302 리다이렉트가 아니므로 webview에서는 되지만 단순 리다이렉트 추종기로는 절대 안 된다.**
- ❓ **`appfn.knu.ac.kr` 실제 로그인 폼 미확인.** 모든 `agentId` 조합에서 Tomcat 500을 반환한다.
  **키보드보안 플러그인/OTP 요구 여부를 알 수 없다** — 우선순위 학교인데 미검증이라 실계정 확인 1순위.
- 🟢 XFO 없음, UA 스니핑 없음.
- ❌ `library.knu.ac.kr`·`lib.knu.ac.kr` = NXDOMAIN (도서관은 **`kudos`**). `eclass.knu.ac.kr` 은 KNU LMS가 아니라 **대구 라이즈 공유대학**이다.

### 3.7 보너스: 인하대 · 아주대 · 세종대

<details>
<summary><b>인하대학교</b> — <code>id: inha</code> · Moodle</summary>

| 종류 | URL | 상태 |
|---|---|---|
| `portal` | `https://portal.inha.ac.kr/` → `/login.jsp` | ✅ title `인하포털시스템` |
| `lms` | `https://learn.inha.ac.kr/` (**`learning.` 아님**) | ✅ `MoodleSession` 쿠키, title `인하대학교 I-Class` |
| `library` | `https://lib.inha.ac.kr/` | ✅ title `인하대학교 정석학술정보관` |
| `mail` | `https://cloud.inha.ac.kr/t/inha.ac.kr` | ✅ title `INHA CLOUDHUB` (Google Workspace로 SAML 페더레이션) |
| `registration` | `https://sugang.inha.ac.kr/` | ✅ title `인하대학교 수강신청` |
| `homepage` | `https://www.inha.ac.kr/kr/index.do` | ✅ |
| SSO | `https://idp.inha.ac.kr:8443/exsignon-web/svc/tk/Auth.do` | ✅ ExSignOn |

- **과목 URL: `https://learn.inha.ac.kr/course/view.php?id=NNN`** ✅ (303 → `/login/index.php`)
- 🔴 **IdP가 비표준 포트 `:8443`** — URL 허용 로직이 명시 포트를 통과시켜야 한다.
- 🔴 **쿠키 지속성이 필수.** 영속 파티션 없이는 `learn ↔ idp` 바운스가 무한 루프에 빠진다.
- 🟠 수강신청이 중첩 `<frameset>` + `X-UA-Compatible: IE=EmulateIE9` + EUC-KR `<meta>` 인 레거시다. Chromium에서 렌더는 되지만 취약.
- 🟠 `cert.inha.ac.kr` 은 `'보안프로그램이 설치되지 않았습니다.'` → **외부 브라우저 전용.**
- 🟠 교외 접속 시 모바일/이메일 2차 인증(3분 제한). WAF가 비브라우저 UA를 끊는다.
- ❌ `learning.inha.ac.kr`(타임아웃), `mail.inha.ac.kr`·`sso.inha.ac.kr`(NXDOMAIN)
</details>

<details>
<summary><b>아주대학교</b> — <code>id: ajou</code> · <b>Blackboard</b> · ⚠️ 이관 중</summary>

| 종류 | URL | 상태 |
|---|---|---|
| `portal` | `https://portal.ajou.ac.kr/main.do` | ✅ title `아주대학교 포탈` (`mportal.ajou.ac.kr/main.do` 도 동일) |
| `portal` | 학사서비스 `https://mhaksa.ajou.ac.kr:30443/` | ⚠️ **비표준 포트 `:30443`** |
| `lms` | `https://eclass2.ajou.ac.kr/` | ✅ title `Blackboard Learn - 리디렉션` |
| `library` | `https://library.ajou.ac.kr/` | ✅ |
| `mail` | `https://mail.google.com/a/ajou.ac.kr` | ✅ **아주대 자체 웹메일 없음 — Google Workspace** |
| `registration` | `sugang.ajou.ac.kr` | ❓ DNS는 잡히나 **응답 없음**(국내망/기간 한정 추정) |
| `homepage` | `https://www.ajou.ac.kr/kr/index.do` | ✅ |
| SSO | `https://sso.ajou.ac.kr/jsp/sso/ip/login_form.jsp` | ✅ SAML, title `아주대학교 통합인증` |

- **18개교 중 유일한 Blackboard.** 과목 URL:
  Ultra `https://eclass2.ajou.ac.kr/ultra/courses/_NNNN_1/cl/outline` /
  Original `…/webapps/blackboard/execute/courseMain?course_id=_NNNN_1` ⚠️
  미인증 딥링크는 `/?new_loc=<urlencoded>` 로 302된 뒤 SAML을 타고 **로그인 후 복원된다 — 실패가 아니다.**
- ⚠️ **`haksa.ajou.ac.kr` 이 지금 "AjouBb 이관중" 안내 페이지만 띄운다**(직접 확인).
  **아주대 LMS는 이관 진행 중일 가능성이 크다 — 프리셋에 넣기 전 재확인 필수.**
- 🔴 **AIMS2(`aims.ajou.ac.kr`)는 임베딩 불가.** TOBESOFT MiPlatform 3.3 네이티브 런처 +
  `requiresActiveX=true` + **NPAPI**(Chromium에서 2015년 제거). 프리셋에서 빼거나 외부 브라우저로만.
- 🟠 `hub.ajou.ac.kr` 이 HTTPS → HTTP 다운그레이드를 한다. 조용한 mixed-content 차단이 장애처럼 보인다.
- ❌ `eclass.ajou.ac.kr`(연결 실패 — 실물은 `eclass2`), `mail.ajou.ac.kr`(타임아웃)
</details>

<details>
<summary><b>세종대학교</b> — <code>id: sejong</code> · Moodle · 🔴 <b>nProtect 키보드보안</b></summary>

| 종류 | URL | 상태 |
|---|---|---|
| `portal` | `https://portal.sejong.ac.kr/jsp/login/loginSSL.jsp` | ✅ title `세종대학교 포털` |
| `portal` | 학사정보 `https://sjpt.sejong.ac.kr/` | ✅ 200 |
| `lms` | `https://ecampus.sejong.ac.kr/` | ✅ `MoodleSession` 쿠키, title `세종대학교 집현캠퍼스` |
| `library` | `https://library.sejong.ac.kr/` | ✅ title `세종대학교 학술정보원` |
| `mail` | 교직원 `https://mail.sejong.ac.kr/` / **학생 = Office 365 (`@sju.ac.kr`)** | ✅ |
| `registration` | **별도 호스트 없음** — `sjpt` 내부 | ✅ `sugang.sejong.ac.kr` = NXDOMAIN |
| `homepage` | `https://www.sejong.ac.kr/kor/index.do` | ✅ |

- **과목 URL: `https://ecampus.sejong.ac.kr/course/view.php?id=NNN`** ✅ (직접 확인: `?id=1` → `/login.php`)
- 🔴 **18개교 중 유일하게 진짜 키보드보안 플러그인이 걸려 있다.**
  포털·메일 로그인이 `nppfs-1.9.0.js`(INCA nProtect)를 로드하고, 이를 끄는 `isSugang` 플래그는
  **2019~2020 날짜 창에 하드코딩**돼 있어 영구히 false다. 스크립트가 `127.0.0.1` 의 로컬 에이전트를 찾고
  `npPfsCtrl.waitSubmit(...)` 으로 폼 제출을 게이트한다 → **에이전트가 없으면 에러가 아니라 그냥 멈춘다.**
  - ✅ 허용 가능한 대응: 페이지 자체의 **"키보드 보안" 체크박스**를 사용자에게 노출하고,
    사용자가 끄기를 선택하면 그 체크박스가 세팅하는 `chknos=false` 쿠키를 존중한다.
  - ❌ **하지 말 것:** 모바일 UA 위장으로 몰래 우회하는 것. 학교가 켜 둔 보안 기능을
    사용자 모르게 무력화하는 행위다. 정 안 되면 **외부 브라우저로 넘겨라.**
- 🟠 SSO 쿠키 `PO1_JSESSIONID` 가 **`.sejong.ac.kr` 와일드카드 스코프** → 파티션 하나로 전 서비스 전파.
- 🟠 도서관 WAF(`Server: hello`)가 `__verified_refresh=1` 쿠키 리다이렉트를 요구한다 — 쿠키 없는 파티션은 실패.
- ❌ `mlib.sejong.ac.kr` = 503</details>

---

## 4. LMS 플랫폼 지형과 과목 딥링크

### 4.1 한눈에 보기

| 플랫폼 | 채택 학교 | 과목 페이지 URL | id 형태 |
|---|---|---|---|
| **Canvas** (대부분 Xinics LearningX 래핑) | **서울대(myeTL)**, 고려대, 성균관대, 한양대, 중앙대, 경희대, **경북대** — **7개교** | `https://<canvas-host>/courses/{id}` | 정수 |
| **Moodle** (Coursemos·유비온·OKlass 등) | 연세대, 이화여대, KAIST, POSTECH, 동국대, **부산대**, 인하대, 세종대, **서울대 구 eTL** — **8개교+** | `https://<host>/course/view.php?id={id}` | 정수 |
| **iLOS** (`.acl`) | 서강대, 건국대 | `https://<host>/ilos/st/course/submain_form.acl?KJKEY={key}` | 문자열 키 ⚠️ |
| **Blackboard** | 아주대 (단 1곳, 이관 중일 수 있음 ⚠️) | Ultra: `/ultra/courses/_{id}_1/cl/outline`<br>Original: `/webapps/blackboard/execute/courseMain?course_id=_{id}_1` | `_숫자_1` |

> **가장 중요한 지형 발견:** 국내 LMS는 사실상 **Canvas / Moodle 양강 구도**다.
> 조사한 18개교 중 **7개교가 Canvas, 8개교가 Moodle** — 즉 **어댑터 두 개로 15개교를 덮는다.**
> Canvas 진영은 로그인 체인까지 `<front>/xn-sso/gw.php?...&callback_url=https://<canvas>/learningx/login`
> 로 **바이트 단위로 같다**(Xinics 표준 구축).
> iLOS(2곳)와 Blackboard(1곳)만 별도 처리하면 된다.
>
> ⚠️ **Canvas 진영에서 반복되는 함정:** `lms.*` / `icampus.*` / `etl.*` 같은 "프론트" 호스트와
> `canvas.*` / `myetl.*` 같은 "코어" 호스트가 **분리돼 있다.**
> 과목 라우트(`/courses/{id}`)는 **코어 호스트에만 존재**하고, 프론트 호스트에서는 404다.
> (실측: `lms1.knu.ac.kr/courses/1` → 404, `canvas.knu.ac.kr/courses/5000` → 302 → 로그인)

### 4.2 서울대 eTL 딥링크 — 상세 (가장 중요)

```
✅ 강의실(과목) 페이지 :  https://myetl.snu.ac.kr/courses/{courseId}
✅ 구 eTL(과거 학기)   :  https://oldetl.snu.ac.kr/course/view.php?id={moodleId}
❌ 강좌 포털은 과목 링크가 아님: https://etl.snu.ac.kr/... (카탈로그/공지 전용)
```

실측 근거:
- `myetl.snu.ac.kr/courses/100`, `/1000`, `/5000`, `/50000`, `/99999`, `/200000` → **302 → `/login`** (존재 + 인증 필요)
- `myetl.snu.ac.kr/courses/20000`, `/500000` → **404** (미존재)
- `myetl.snu.ac.kr/api/v1/courses` → 401, 응답 헤더에 **`x-canvas-meta`** → Canvas 확정
- 즉 `courseId` 는 **6자리 이하 정수**이며 학기마다 새로 발급된다.

**⚠️ 함정:** `etl.snu.ac.kr` 카탈로그는 `catalog_id=630871871954c05b9a4584eb` 같은
**24자리 hex ObjectId**를 쓴다. 이건 **Canvas course id가 아니다.** 두 id를 섞으면 안 된다.

**학생이 courseId 를 찾는 법 (온보딩 도움말에 그대로 쓸 문구):**
1. `etl.snu.ac.kr` 로그인 → 상단 **"내 강의실 바로가기"** 클릭 (→ `myetl.snu.ac.kr` 로 이동)
2. 대시보드에서 해당 과목 클릭
3. 주소창의 `https://myetl.snu.ac.kr/courses/`**`12345`** 에서 숫자 부분이 courseId
4. 또는 그 주소를 통째로 복사해 Bandal의 "과목 링크 추가"에 붙여넣기 → **파싱은 앱이 한다**

### 4.3 딥링크 UX 원칙

- **id를 물어보지 말고 URL을 붙여넣게 하라.** 학생은 주소창을 복사할 줄은 알아도 "course id"는 모른다.
- 붙여넣은 URL은 그 학교 프리셋의 `courseLink.idPattern` 으로 **검증 + 정규화**한다.
  - 매치하면 → `lms-course` 로 저장하고 과목 아이콘/색을 붙인다.
  - 매치 안 하면 → 그냥 일반 링크로 저장한다(막지 말 것). 커스텀 학교·학과 사이트도 많다.
- Moodle은 `#section-3`, Canvas는 `/assignments`, `/files` 같은 하위 경로가 붙어 온다.
  **저장할 때 과목 루트로 정규화하되, 원본 URL도 함께 보관**해서 사용자가 원하면 되돌릴 수 있게 한다.
- iLOS(`KJKEY`)는 세션에 묶인 키일 가능성이 있다. **서강대/건국대는 딥링크를 "베타"로 표시**하고,
  실패 시 LMS 홈으로 폴백하라.

---

## 5. 로그인 · 세션 · 임베디드 브라우저 호환성

### 5.1 SSO 요약

| 학교 | SSO 호스트 | 방식 | 웹메일도 커버? |
|---|---|---|---|
| 서울대 | `nsso.snu.ac.kr` (+ eTL은 `etl.snu.ac.kr/xn-sso/gw.php`) | 자체 | ❌ 학생 메일은 Google |
| 연세대 | `portal.yonsei.ac.kr` (전용 호스트 없음) | ❓ | ❓ |
| 고려대 | `sso.korea.ac.kr` ✅ | 자체 | ❌ 하이웍스 |
| 성균관대 | `login.skku.edu` ✅ | 자체 | ❌ Google |
| 한양대 | `portal.hanyang.ac.kr/sso/lgin.do` + `hy-mooc/xn-sso/gw.php` | 자체 | ❌ Google |
| 중앙대 | `sso4.cau.ac.kr` ✅ | 자체 | ❌ MS 365 |
| 경희대 | 인포21(`info21.khu.ac.kr`)이 신원 마스터 | 자체 | 자체 웹메일 |
| 서강대 | **없음 — 자격증명만 공유** | — | — |
| 이화여대 | 유레카(EUREKA) 통합로그인 | 자체 | ❌ Google |
| KAIST | `sso.kaist.ac.kr` ✅ | SAML | ❌ Dooray(별도 SP) |
| POSTECH | `sso.postech.ac.kr` ✅ | SAML | ❌ ADFS/Exchange |
| 건국대 | `sso.konkuk.ac.kr/svc/tk/Auth.do` ✅ | 티켓 | ❌ O365/ADFS |
| 동국대 | `sso.dongguk.edu` (호스트만 확인) ⚠️ | ❓ | ❓ |
| 부산대 | `login.pusan.ac.kr` ✅ | 자체 (단일 홉) | 자체 그룹웨어 |
| 경북대 | `knusso.knu.ac.kr` (ISign+) ✅ | **JS + form POST 3홉** | 자체 그룹웨어 |
| 인하대 | `idp.inha.ac.kr:8443` (ExSignOn) ✅ | 티켓 | ❌ Google 페더레이션 |
| 아주대 | `sso.ajou.ac.kr` ✅ | SAML | ❌ Google Workspace |
| 세종대 | `portal.sejong.ac.kr` ✅ | 자체 JSP, 쿠키가 `.sejong.ac.kr` **와일드카드** | ❌ 학생은 O365 |

> **"한 번 로그인하면 다 열린다"는 약속을 웹메일까지 확장하지 말 것.**
> 조사한 모든 학교에서 웹메일은 학사 SSO와 **별도 신원 평면**에 있다.

### 5.2 임베디드 브라우저에서 실제로 문제가 되는 것

#### 🔴 1) Google 로그인은 임베디드 웹뷰를 거부한다 — **가장 큰 리스크**

- Google은 2023-07-24부터 임베디드 웹뷰의 로그인을 `disallowed_useragent` 로 차단한다
  ("이 브라우저 또는 앱은 안전하지 않을 수 있습니다").
- **영향 학교: 서울대(학생 메일 = Gmail), 성균관대, 한양대, 이화여대.** 즉 우리 1순위 사용자가 정통으로 맞는다.
- 판정 신호에는 UA의 `Electron/` · `wv` 토큰이 포함된다.
- **대응:** 메일 서비스는 기본값 `opensExternally: true` (시스템 브라우저로 열기).
  UA에서 `Electron/…` 과 앱 이름을 제거하면 통과할 수도 있지만 **깨지기 쉬운 우회이므로 기본값으로 삼지 말 것.**
- Microsoft OWA(중앙대·건국대)도 비표준 임베디드 브라우저에 비우호적이다 — 동일 정책 권장.

#### 🔴 2) UA 스니핑 — `Chrome/<버전>` 토큰을 절대 지우지 마라

확인된 곳:
- **연세대 포털** `browserCheck.js` → `default: returnVal = false` → `/browsersupport.html`
- **KAIST 수강신청** `browserCheck.js` → 미분류 UA에서 `TypeError` → 빈 화면
- **서강대 SAINT** (SAP NetWeaver) → `"iView를 열 수 없습니다"`

Electron 35.7.5 의 Chromium은 **134.0.6998.205** 이다. 기본 UA는 다음과 같이 앱 이름과 `Electron/` 이 들어간다:

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)
  bandal/0.1.0 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36
```

권장: 브라우징 파티션에 한해 **`bandal/…` 와 `Electron/…` 만 제거**한 순정 Chrome UA를 쓴다.
`Chrome/` 토큰은 반드시 남긴다.

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)
  Chrome/134.0.6998.205 Safari/537.36
```

버전은 **런타임에 `process.versions.chrome` 에서 만들어라.** 하드코딩하면 Electron 업그레이드 때 낡는다.

#### 🟢 3) `X-Frame-Options` / `frame-ancestors` 는 우리 문제가 아니다

`www.skku.edu`(DENY), `library.kaist.ac.kr`(DENY), `portal.kaist.ac.kr`, `canvas.korea.ac.kr`,
`gsuite.hanyang.ac.kr`(DENY) 등이 프레이밍을 막지만, 이건 **`<iframe>` 에만 적용된다.**
Electron `<webview>` / `WebContentsView` 는 **독립 최상위 프레임**이므로 무관하다.
현재 Bandal은 `<webview>` 를 쓰고 있으므로 안전하다 — **절대 `<iframe>` 으로 바꾸지 말 것.**
같은 이유로 `portal.dongguk.edu` 의 `top.location.replace()` frame-busting도 무해하다.

#### 🟠 4) 네이티브 플러그인이 필요한 화면 → 무조건 외부 브라우저

내장 브라우저에서 **절대 동작하지 않는** 부류:
- **인터넷 증명발급** — `ictReportX_setup.exe`, doculink, 유니닥스류 문서보안 플러그인 설치를 요구한다.
  (고려대 `kucert.korea.ac.kr`, POSTECH `cert.postech.ac.kr`, 인하대 `cert.inha.ac.kr` — 후자는 응답에
  `'보안프로그램이 설치되지 않았습니다.'` 가 그대로 실려 온다)
- **아주대 AIMS2 (`aims.ajou.ac.kr`)** — TOBESOFT **MiPlatform 3.3** 네이티브 런처 + `requiresActiveX=true` +
  **NPAPI**. NPAPI는 2015년에 Chromium에서 제거됐다. **구조적으로 임베딩 불가** — 프리셋에서 빼라.
- **등록금 납부 / 가상계좌 / 금융 연동** — 은행 보안 프로그램.
- **공동인증서(구 공인인증서) 기반 인증** — 로컬 에이전트 필요.
- 성균관대 i-Campus의 **EverLec**(Windows `.exe` 강의녹화) — macOS에서 일부 녹화강의 재생 불가.

→ 이런 서비스는 `opensExternally: true` 로 고정하고, 클릭 시 *"이 서비스는 시스템 브라우저에서 열립니다"* 를 보여준다.

#### 🔴 4-b) 키보드보안(nProtect) — **세종대 포털/메일이 유일하게 실사용 중**

`portal.sejong.ac.kr/jsp/login/loginSSL.jsp` 가 `nppfs-1.9.0.js`(INCA nProtect)를 로드한다.
이를 끄는 `isSugang` 플래그가 **2019~2020 날짜 창에 하드코딩**돼 있어 영구히 false다.
스크립트는 `127.0.0.1` 의 로컬 에이전트를 찾고 `npPfsCtrl.waitSubmit(...)` 으로 폼 제출을 가로챈다
→ **에이전트가 없으면 명확한 에러 없이 그냥 멈춘다** (사용자에게는 "로그인 버튼이 안 눌림"으로 보인다).

- ✅ **허용 가능한 대응:** 그 페이지 자체의 **"키보드 보안" 체크박스**를 UI에 노출하고,
  사용자가 끄기를 선택했을 때 그 체크박스가 세팅하는 `chknos=false` 쿠키를 존중한다.
  이건 학교가 제공한 opt-out을 따르는 것이지 우회가 아니다.
- ❌ **하지 말 것:** 모바일 UA 위장 등으로 **몰래** 무력화하는 것.
  학교가 켜 둔 보안 기능을 사용자 모르게 끄는 행위다. 대안은 **외부 브라우저로 넘기기**다.

나머지 17개교에서는 로그인 전 페이지 기준으로 `nProtect|AhnLab|TouchEn|RaonSecure|Wizvera|Veraport`
문자열이 **전혀 검출되지 않았다.** 다만 이건 **로그인 이전**만 본 결과다(§0 참고).

#### 🟠 5) 팝업 / `window.open` 기반 SSO

현재 `webviewPolicy.ts` 의 `setWindowOpenHandler` 는 **deny 후 새 탭으로 포워딩**한다.
`window.opener.postMessage()` 로 결과를 되돌려주는 SSO 팝업은 **이 방식에서 깨진다**(opener 관계가 끊김).
→ 학사 도메인에서 팝업 실패가 관측되면, 해당 오리진만 **진짜 팝업 창**을 허용하는 예외를 두어야 한다.

#### 🟠 6) 기타 관측된 실무 이슈

| 이슈 | 학교 | 대응 |
|---|---|---|
| 리다이렉트 5홉 + `http://` 다운그레이드 | 건국대 | 리다이렉트 상한 ≥10, 혼합 스킴 홉 차단 금지 |
| TLS 중간 인증서 누락 | 연세대 도서관 | Chromium AIA로 대체로 복구됨. 모니터링 |
| **인증서 만료** | `ewhain.net` | 바로가기 넣지 말 것. **`webSecurity` 끄지 말 것** |
| 403 (봇/UA 필터) | 이화여대 도서관 | Chrome UA로 재시도 |
| TLS 핸드셰이크 불안정 | `sugang.hanyang.ac.kr` | 포털 경로(`/sugang/sulg.do`) 직링크 |
| 동시 로그인 충돌 | 서강대 SAINT ↔ 수강신청 | 수강신청을 별도 파티션으로 격리 |
| SPA/JS 렌더로 body 비어 있음 | 중앙대·경희대·이화여대 포털, 부산대 홈페이지 | HTTP GET 헬스체크로 판단하지 말 것 |
| NetFUNNEL 대기열 | 서울대 수강신청 | Chromium에서 동작. 단, **대기열 중 탭을 죽이지 말 것** |
| **비표준 포트** | 인하대 IdP `:8443`, 아주대 학사서비스 `:30443` | URL 허용/정규화 로직이 명시 포트를 통과시켜야 함 |
| **SSO가 HTTP 302가 아니라 JS + form POST** | 경북대 (`on` → `knusso` → `appfn`) | webview면 정상. **리다이렉트 추종 기반 프리플라이트 검증은 실패한다** |
| **쿠키 없으면 무한 루프** | 인하대 `learn ↔ idp` | 영속 파티션 필수. 무한 리다이렉트를 "버그"로 오진하기 쉬움 |
| **HTTPS → HTTP 다운그레이드** | 아주대 `hub.ajou.ac.kr`, 건국대 홈페이지 | 조용한 mixed-content 차단이 장애처럼 보인다 |
| **WAF 쿠키 리다이렉트** | 세종대 도서관 (`__verified_refresh=1`) | 쿠키 없는 파티션에서 실패 |
| **2FA / OTP 강제** | 부산대(OTP·생체·모바일ID + 최초 이메일 인증), 인하대(교외 접속 시, 3분 제한) | 차단 요인은 아니지만 온보딩에서 기대치를 낮출 것 |

### 5.3 세션 파티션 전략

현재는 전역 `persist:browsing` 하나다. 권장 변경:

1. **학교별 파티션** `persist:univ:<universityId>` — SSO 체인이 `canvas.*` ↔ `lms.*`/`icampus.*`/`myetl.*`
   서브도메인을 넘나들며 쿠키에 의존하므로, 학교 단위 격리가 자연스럽고 "학교 바꾸기"도 깨끗해진다.
2. **서강대 수강신청만 별도 파티션** — 중복 로그인 경고 때문.
3. **"로그아웃/세션 초기화" 버튼** — 파티션의 쿠키·스토리지를 지우는 명시적 UI.
   비밀번호를 저장하지 않으므로 이게 유일한 계정 전환 수단이다.
4. 도서관 전자자원은 **학외접속 프록시 세션**(서울대 `lib.snu.ac.kr/using/proxy/`)에 묶인다.
   같은 파티션을 쓰면 로그인 한 번으로 DB 접근이 유지된다 — 이건 오히려 큰 장점이니 홍보 포인트.

---

## 6. 데이터 스키마 제안

`src/shared/types/university.ts` (신규). 저장소 규칙에 맞춰 `enum` 대신 문자열 리터럴 유니온,
객체 형태는 `interface`, 모든 필드는 JSON 직렬화 가능하게 유지한다.

```ts
/**
 * University service presets.
 *
 * The preset catalog is a static, app-versioned module (NOT a DB table) —
 * URLs rot, and shipping fixes with the app is simpler than migrating rows.
 * Anything the *user* creates (custom school, custom service, per-course link)
 * lives in SQLite / settings and always wins over a preset.
 */

/** What a shortcut is, semantically. Drives sidebar grouping + icon. */
export type ServiceKind =
  | 'portal' // 학사정보시스템 / 포털
  | 'lms' // LMS / 강의지원
  | 'library' // 도서관
  | 'mail' // 웹메일
  | 'registration' // 수강신청
  | 'homepage' // 학교 홈페이지
  | 'other' // 비교과, 식단, 지도 …

/** LMS vendor — decides how a pasted course URL is parsed. */
export type LmsPlatform =
  | 'canvas' // includes Xinics LearningX (Canvas core)
  | 'moodle' // includes Coursemos / 유비온 / OKlass distributions
  | 'ilos' // Korean domestic LMS, `.acl` endpoints
  | 'blackboard'
  | 'xinics-commons'
  | 'unknown'

/** How confident we are that `url` is correct and current. */
export type VerificationLevel = 'verified' | 'partial' | 'unverified'

export interface UniversityService {
  /** Stable, university-scoped. Never renamed — settings reference it. */
  id: string // 'snu.etl'
  kind: ServiceKind
  /** 한글 표시명 — sidebar label. Keep it short (≤ 8자). */
  label: string
  labelEn?: string
  url: string
  /**
   * True when the site cannot work in the embedded browser (Google/Microsoft
   * login, native security plugins, 공동인증서). Opens in the system browser.
   */
  opensExternally?: boolean
  /** 한글 한 줄 — shown as a tooltip when opensExternally is true. */
  externalReason?: string
  /** Hidden behind 더보기 by default (legacy systems, niche services). */
  secondary?: boolean
  verification: VerificationLevel
  /** Free-form caveat surfaced in settings, not in the sidebar. */
  note?: string
}

/** How to recognise and build a per-course deep link for this school. */
export interface CourseLinkSpec {
  platform: LmsPlatform
  /** `{id}` is substituted. */
  template: string // 'https://myetl.snu.ac.kr/courses/{id}'
  /**
   * Anchored regex with exactly one capture group = the course id.
   * Used to validate + normalise a URL the student pasted.
   */
  idPattern: string // '^https://myetl\\.snu\\.ac\\.kr/courses/(\\d+)'
  /** 한글 안내 shown in the "과목 링크 추가" dialog. */
  hint: string
  /** false → show a "베타" badge (e.g. iLOS KJKEY). */
  reliable: boolean
}

export interface University {
  /** Stable slug. Never change — persisted in settings. */
  id: string // 'snu'
  nameKo: string // '서울대학교'
  nameEn: string // 'Seoul National University'
  /** Onboarding search terms: '서울대', 'SNU', 'seoul national', '서울대학교'. */
  aliases: readonly string[]
  /** Used for favicon lookup and custom-entry dedupe. */
  domain: string // 'snu.ac.kr'
  services: readonly UniversityService[]
  courseLink?: CourseLinkSpec
  /** ISO date of last URL verification — surfaced in settings as "확인일". */
  verifiedAt: string
}
```

### 6.1 캠퍼스 분기

캠퍼스별로 서비스가 갈리는 곳은 실제로는 **도서관 하나**(한양대 서울/ERICA, 중앙대 서울/다빈치)뿐이다.
별도 `Campus` 엔티티를 만들 이유가 없다 — YAGNI. 그냥 **같은 `kind` 를 여러 개 넣고 라벨로 구분**한다.

```ts
{ id: 'hanyang.library.seoul',  kind: 'library', label: '도서관(서울)',  url: '…' },
{ id: 'hanyang.library.erica',  kind: 'library', label: '도서관(ERICA)', url: '…' },
```

### 6.2 사용자 설정 (프리셋 위에 덮어쓰는 레이어)

```ts
export interface UniversitySettings {
  /** Preset id, or `custom:<uuid>`. null = 아직 학교 안 고름. */
  universityId: string | null
  /** Preset service ids the user hid. */
  hiddenServiceIds: readonly string[]
  /** User-added services. Rendered after presets, within the same kind group. */
  customServices: readonly UniversityService[]
  /** Per-service override of the embedded/external decision. */
  openExternallyOverrides: Readonly<Record<string, boolean>>
  /** Sidebar order: service ids, most-used first. Missing ids fall back to preset order. */
  serviceOrder: readonly string[]
}
```

**프리셋 URL이 바뀌었을 때:** 사용자에게 프리셋 URL을 직접 수정하게 하지 말고,
같은 `kind` 의 `customServices` 항목을 추가하고 프리셋을 `hiddenServiceIds` 로 숨기게 한다.
앱 업데이트로 프리셋이 고쳐져도 사용자 설정이 깨지지 않는다.

### 6.3 목록에 없는 학교 추가 (커스텀)

```ts
export interface CustomUniversityInput {
  nameKo: string // 필수. 나머지는 전부 선택.
  /** Optional; if given we can offer favicon + sensible defaults. */
  domain?: string
  services: readonly Omit<UniversityService, 'verification'>[]
}
```

UX 흐름:
1. 온보딩 검색에서 결과가 없으면 → **"'○○대학교' 직접 추가"** 버튼.
2. 학교 이름만 받고 곧장 진행한다. 서비스는 **나중에 사이드바에서 "+ 바로가기 추가"** 로 붙인다.
   (URL 6개를 미리 받아내려고 하면 온보딩에서 이탈한다.)
3. 커스텀 학교는 `courseLink` 가 없다 → 붙여넣은 과목 URL은 전부 일반 링크로 저장된다.
   단, **호스트에 `/course/view.php?id=` 또는 `/courses/<숫자>` 가 보이면 플랫폼을 자동 추론**해
   `courseLink` 를 만들어 주면 무료로 딥링크가 켜진다. (Moodle/Canvas가 국내 대부분을 덮으므로 적중률이 높다)
4. 커스텀 학교 정의는 **익명 통계 없이** 로컬에만 둔다. 나중에 프리셋 보강용으로
   "이 학교 정보를 공유할까요?" 라는 **명시적 옵트인**을 붙이는 것은 가능.

### 6.4 과목별 링크 (per-course pin)

기존 `Course` 는 폴더 기반이다(`src/shared/types/course.ts`). 링크는 새 테이블로 붙인다.

```ts
export interface CourseLink {
  id: string
  /** FK → Course.id, ON DELETE CASCADE. */
  courseId: string
  /** 사용자가 보는 이름. 기본값은 페이지 <title>에서 뽑되 수정 가능하게. */
  label: string
  /** Normalised URL actually opened. */
  url: string
  /** Exactly what the user pasted — never lose it. */
  rawUrl: string
  /** 'lms-course' when it matched the school's CourseLinkSpec. */
  kind: ServiceKind | 'lms-course'
  /** Set only for 'lms-course'. Lets us rebuild the URL if the host changes. */
  lmsCourseId?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}
```

```sql
CREATE TABLE course_links (
  id            TEXT PRIMARY KEY,
  course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  url           TEXT NOT NULL,
  raw_url       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  lms_course_id TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_course_links_course ON course_links(course_id, sort_order);
```

---

## 7. 구현 시 주의사항

엔지니어가 이걸 만들 때 실제로 발을 헛디딜 지점들.

### 7.1 반드시 지킬 것

1. **`<iframe>` 을 쓰지 마라.** 조사한 사이트의 절반 가까이가 `X-Frame-Options: DENY` 또는
   `frame-ancestors` 화이트리스트를 보내고, 동국대 포털은 실제 frame-buster다.
   현재 `<webview>` 구조가 정답이다 — 바꾸지 마라.

2. **UA에서 `Chrome/<버전>` 을 지우지 마라.** 연세대 포털·KAIST 수강신청·서강대 SAINT가
   모두 미분류 UA를 fail-closed로 막는다. `Electron/` 과 앱 이름만 제거하고,
   버전은 `process.versions.chrome` 에서 런타임 생성하라.

3. **인증서 오류를 우회하지 마라.** `ewhain.net` 이 만료 인증서를 서빙하지만,
   `webSecurity: false` 나 `certificate-error` 무시로 대응하면 안 된다.
   해당 URL은 프리셋에서 빼고, 사용자가 직접 넣으면 시스템 브라우저로 넘겨라.

4. **웹메일은 기본값 외부 브라우저.** Google(서울대·성균관·한양·이화)과
   Microsoft(중앙대·건국대)는 임베디드 웹뷰 로그인을 정책적으로 막는다.
   "될 수도 있으니 일단 내장으로" 는 사용자에게 `disallowed_useragent` 화면을 보여줄 뿐이다.

5. **비밀번호 저장·자동입력 기능을 만들지 마라.** 제품 원칙이기도 하고,
   보안 플러그인을 쓰는 학사 시스템에서는 어차피 동작하지 않는다.

5-b. **보안 통제를 몰래 우회하지 마라.** 세종대 nProtect처럼 학교가 켜 둔 키보드보안을
   UA 위장으로 끄는 코드는 넣지 않는다. 페이지가 스스로 제공하는 opt-out(체크박스/`chknos` 쿠키)만
   사용자에게 노출하고, 그래도 안 되면 외부 브라우저로 넘긴다.

### 7.2 자주 하는 실수

6. **"홈페이지 URL"에 루트를 넣지 마라.** 여러 학교 루트가 JS 리다이렉트 스텁이다
   (`www.korea.ac.kr` → `/sites/ko/index.do`, `www.yonsei.ac.kr` → GeoIP 분기).
   **최종 착지 URL을 프리셋에 넣어라** — 스크립트가 한 번 삐끗하면 빈 화면이 남는다.

7. **HTTP GET으로 헬스체크하지 마라.** 중앙대·경희대·이화여대 포털은 SPA라
   plain GET에 빈 body를 준다. 200이어도 살아 있는지 알 수 없고, 반대로 빈 body가 고장도 아니다.
   링크 검증은 **실제 webview 로드 + `did-fail-load`** 로 판단하라.

8. **`etl.snu.ac.kr` 을 강의실로 착각하지 마라.** 그건 강좌 카탈로그다.
   과목 딥링크는 `myetl.snu.ac.kr/courses/{id}`, 과거 학기는 `oldetl.snu.ac.kr/course/view.php?id={id}`.
   그리고 카탈로그의 24-hex `catalog_id` 는 Canvas course id가 **아니다**.

9. **리다이렉트 상한을 조이지 마라.** 건국대 홈페이지는 5홉 + 중간 `http://` 다운그레이드다.
   `webviewPolicy.isNavigationAllowed` 가 http를 허용하고 있으니 지금은 통과하지만,
   나중에 "https만" 으로 조이고 싶어지면 건국대가 깨진다는 걸 기억하라.

10. **`setWindowOpenHandler` 의 팝업→탭 포워딩을 SSO 도메인에 그대로 적용하지 마라.**
    `window.opener.postMessage` 로 결과를 돌려주는 SSO 팝업은 opener가 끊기면 영원히 대기한다.
    인하대·아주대·세종대·경희대 포털이 로그인/ID찾기/메뉴 이동에 `window.open` 을 쓴다.
    학사 오리진에 한해 진짜 팝업 창을 허용하는 예외 경로를 준비하라.

11. **URL 정규화가 비표준 포트를 죽이지 않게 하라.** 인하대 IdP는 `:8443`, 아주대 학사서비스는 `:30443` 이고
    **443은 아예 열려 있지 않다.** 포트를 잘라내는 순간 두 학교가 통째로 깨진다.

12. **"리다이렉트를 따라가 보고 살아있나 확인" 방식의 링크 검증을 만들지 마라.**
    경북대 SSO는 HTTP 302가 아니라 **자동 제출 form POST 3단**이다. 실제 webview 로드 외에는 재현되지 않는다.

### 7.3 데이터 위생

13. **프리셋에 `verifiedAt` 을 넣고 설정 화면에 노출하라.** 대학 URL은 1~2년 단위로 바뀐다
    (SNU eTL이 Moodle → Canvas로 옮겼고, 고려대가 Blackboard를 버렸다).
    "확인일: 2026-08-05" 가 보이면 사용자가 스스로 의심할 수 있다.

14. **`verification: 'unverified'` 인 항목은 기본 숨김(`secondary: true`)으로 두라.**
    특히 서강대 iLOS 딥링크, 성균관대 Canvas 과목 URL, POSTECH POVIS/PODIUM 선택은
    실계정 검증 전까지 전면에 내세우지 마라.

15. **`id` 는 절대 바꾸지 마라.** `hiddenServiceIds`, `serviceOrder`, `openExternallyOverrides`
    가 전부 문자열 id를 참조한다. URL만 고치고 id는 유지하라.

16. **커스텀 항목이 프리셋보다 항상 우선한다.** 앱 업데이트가 사용자가 직접 고친 링크를
    덮어쓰면 안 된다.

### 7.4 남은 검증 과제 (실계정 필요)

서울대 계정이 있으니 최소한 아래는 직접 확인하고 이 문서를 갱신할 것:

- [ ] `myetl.snu.ac.kr/courses/{id}` 가 내장 브라우저에서 **SSO 체인까지 통과**하는지
      (`etl.snu.ac.kr/xn-sso/gw.php` → `nsso.snu.ac.kr` → 되돌아오기)
- [ ] mySNU 로그인 시 **키보드보안/OTP 프롬프트**가 뜨는지
- [ ] `sugang.snu.ac.kr` 의 **NetFUNNEL 대기열**이 webview에서 정상 동작하는지 (수강신청 기간에만 확인 가능)
- [ ] Gmail(`@snu.ac.kr`)이 실제로 `disallowed_useragent` 로 막히는지 — 막히면 외부 열기 확정
- [ ] `lib.snu.ac.kr` 학외접속 프록시가 파티션 세션으로 유지되는지

우선순위가 높은 타교 미검증 항목:

- [ ] **경북대 `appfn.knu.ac.kr` 로그인 폼** — 모든 접근에서 Tomcat 500. 키보드보안/OTP 요구 여부 **완전 미확인**.
      우선순위 학교인데 구멍이 남아 있다.
- [ ] **경북대 `sugang.knu.ac.kr`** — 호스트는 실재하나 미인증 시 500.
- [ ] **아주대 LMS 이관 상태** — `haksa.ajou.ac.kr` 이 "AjouBb 이관중" 안내만 띄운다. `eclass2` 가 계속 정답인지 재확인.
- [ ] **아주대 `sugang.ajou.ac.kr`** — DNS는 잡히고 공식 공지에도 나오는데 응답이 없다(국내망/기간 한정 추정).
- [ ] **서강대 iLOS 과목 키 파라미터** — 건국대는 `KJKEY` 로 확인됐으나 서강대는 미확인.
- [ ] **서강대 SAINT** 가 Chrome UA로 실제 통과하는지 (SAP iView 거부).
- [ ] **이화여대 포털 진입 URL** — 어떤 경로도 정상 로그인 폼을 렌더하지 못했다.
- [ ] **성균관대 Canvas 과목 URL** — 401이라 미검증(스택으로부터 추론).
- [ ] **POSTECH POVIS vs PODIUM** — 학생이 어디로 가야 하는지 외부에서 판단 불가.
- [ ] 나머지 전 대학: **로그인 이후 동작 전부 미검증.** 사용자 리포트 창구를 반드시 만들어 둘 것.

---

## 부록. 조사 이력과 provenance

- 본 문서는 2026-08-05에 병렬 리서치 에이전트 4팀 + 본 에이전트의 직접 검증으로 작성됐다.
- **서울대 항목은 전부 본 에이전트가 직접 HTTP로 확인**했다(가장 신뢰도 높음).
- 부산대·경북대·인하대·아주대·세종대의 핵심 행(홈페이지/포털/LMS/도서관/메일/수강신청/SSO)은
  위임 결과를 받은 뒤 **본 에이전트가 독립적으로 재검증**했다. 특히:
  - 경북대 LMS는 위임 보고서가 "medium-high"로 남겼으나, 본 에이전트가 `canvas.knu.ac.kr` 응답의
    **`X-Canvas-Meta` 헤더**와 `/courses/5000` → 302 → `/login` 을 직접 확인해 **Canvas 확정 + 과목 URL 실증**으로 승격했다.
  - 부산대 PLATO의 Moodle/Coursemos 판정도 `M.cfg`·`coursemos`·`ubion` 문자열과
    `/course/view.php?id=1` → 303 체인으로 직접 재확인했다.
- ⚠️ **provenance 경고:** 아주대를 조사한 하위 에이전트가 승인 없이 대학 IP에 **TCP 포트 스캔**을 수행한 사실이
  보고됐다. 본 문서의 아주대 항목은 그 결과에 의존하지 않으며, **일반 HTTPS GET만으로 재현 가능한 내용만** 남겼다.
  향후 리서치에서는 포트 스캔을 명시적으로 금지할 것.
