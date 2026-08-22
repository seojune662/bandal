# 배포와 자동 업데이트

macOS·Windows 설치 파일을 만들고, 새 버전이 나오면 앱이 스스로 알리게 하는 전체 경로.

관련 파일: `electron-builder.yml`, `.github/workflows/release.yml`,
`src/main/features/updater/`, `resources/entitlements.mac.plist`.

v0.26.0부터 macOS 12 이상과 Electron 43을 지원한다.

---

## 1. 한 줄 요약

`package.json` 의 `version` 을 올리고 같은 값으로 태그를 밀면 끝난다.

```bash
# package.json version 을 0.2.0 으로 수정한 뒤
git commit -am "chore: v0.2.0"
git tag v0.2.0
git push origin main --tags
```

GitHub Actions 가 macOS(arm64·x64)와 Windows(x64)를 병렬로 빌드하고, mac 쪽은
서명·공증까지 마친 뒤 `seojune662/bandal` 릴리스에 올린다. 양쪽이 모두 성공해야
draft 가 풀린다.

**태그와 `package.json` 의 version 은 정확히 같아야 한다.** 다르면 워크플로 첫
단계에서 실패한다. electron-updater 가 이 둘을 비교하기 때문에, 어긋난 채로
나가면 학생에게 업데이트가 영영 안 뜨거나 이미 설치한 버전을 다시 권한다.

> ⚠ 그래서 **`v0.1.0` 인데 `package.json` 은 `0.1.0`, 이런 식으로만 맞는다.**
> `package.json` 이 `0.1.0` 인 채로 `v0.1.0-rc.1` 을 밀면 verify 에서 막힌다
> (실제로 한 번 그렇게 막혔다). 프리릴리스로 리허설하고 싶으면 `package.json`
> 도 `0.1.0-rc.1` 로 같이 올려야 한다 — 다만 그럴 필요는 거의 없다.
> **안전장치는 프리릴리스 태그가 아니라 draft 다**: 한 플랫폼이라도 실패하면
> 릴리스는 draft 로 남아 사용자에게 보이지 않는다. 그냥 진짜 버전으로 밀고
> 결과를 보면 된다.

---

## 2. 왜 레포가 하나인가

소스·워크플로·릴리스가 모두 `seojune662/bandal` 에 있다.

- Actions 의 내장 `GITHUB_TOKEN` 은 **자기 레포에만** 쓸 수 있다. 릴리스를 다른
  레포로 보내려면 `repo` 스코프 PAT 를 만들어 시크릿에 넣고 주기적으로 갱신해야
  한다. 한 레포면 토큰 설정이 아예 없다.
- electron-builder 는 같은 릴리스 안에 `latest-mac.yml` 과 `latest.yml` 을 **다른
  파일명으로** 올리고, electron-updater 는 실행 중인 OS 에 맞는 쪽만 읽는다. 한
  릴리스에 mac·Windows 산출물이 같이 있어도 서로 간섭하지 않는다.

`bandal_mac` / `bandal_windows` 레포는 쓰지 않는다.

---

## 3. 필요한 시크릿

레포 Settings → Secrets and variables → Actions.

| 시크릿 | 없으면 생기는 일 |
|---|---|
| `MAC_CERT_P12` | mac 빌드가 미서명 → Gatekeeper 가 막고 **자동 업데이트도 불가** |
| `MAC_CERT_PASSWORD` | 위와 같음 |
| `APPLE_API_KEY_P8` | 공증 실패 |
| `APPLE_API_KEY_ID` | 공증 실패 |
| `APPLE_API_ISSUER` | 공증 실패 |
| `APPLE_TEAM_ID` | 공증 실패 |
| `MAIN_VITE_SUPABASE_URL` | 배포판에서 **"함께하기" 기능이 통째로 사라진다** |
| `MAIN_VITE_SUPABASE_PUBLISHABLE_KEY` | 위와 같음 |

마지막 두 개는 비활성화가 아니라 *부재* 다 — `.env.example` 의 설명 참조.
`service_role` 키는 어디에도 넣지 않는다.

`.p12` 는 base64 로 넣는다: `base64 -i cert.p12 | pbcopy`

App Store Connect API 키는 Users and Access → Integrations → **Team Keys**,
역할 **App Manager**. `.p8` 은 한 번만 받을 수 있다. Apple ID + 앱 암호 대신 API
키를 쓰는 이유는 2FA 프롬프트가 없고 만료되지 않아서다.

---

## 4. macOS 서명의 함정

`hardenedRuntime: true` 는 공증의 전제 조건이고, 기본적으로 여러 기능을 막는다.
`resources/entitlements.mac.plist` 의 네 항목은 전부 **실제로 뭔가가 깨져서**
들어간 것이다. 그리고 이 문제들은 **서명된 빌드에서만 재현된다** — `pnpm dev`
에서는 절대 안 보인다.

| 빠지면 | 증상 |
|---|---|
| `allow-jit`, `allow-unsigned-executable-memory` | 렌더러가 실행 즉시 죽는다 |
| `disable-library-validation` | 앱은 뜨는데 DB 초기화 실패 다이얼로그 |
| `allow-dyld-environment-variables` | 앱은 멀쩡한데 **채팅만** 안 된다 |

그래서 릴리스 전 검증은 반드시 **공증된 dmg** 로 한다:

```bash
codesign --verify --deep --strict /Applications/Bandal.app
spctl -a -vvv -t install /Applications/Bandal.app   # → source=Notarized Developer ID
```

그리고 앱을 열어 **과목 추가 → PDF 열기 → 채팅 1회**까지 해 본다.

---

## 5. 설치 파일 크기

dmg 는 약 95 MB 다. 그중 **204 MB(압축 전) 는 Electron 프레임워크 자체**라 더
줄일 수 없다. 우리 코드는 35 MB 뿐이다.

원래 148 MB 였고, 두 가지로 줄였다.

1. **`dependencies` 를 런타임에 진짜 필요한 것만 남겼다.** electron-builder 는
   `dependencies` 전체를 설치 파일에 넣는다. 하지만 렌더러가 쓰는 패키지
   (milkdown, pdfjs-dist, react, dockview …) 는 vite 가 `out/renderer` 로 번들하므로
   런타임에 필요 없다. 지금 `dependencies` 에 있는 건 다섯 개뿐이다:

   ```
   @supabase/supabase-js  better-sqlite3  chokidar  cross-spawn  electron-updater
   ```

   **렌더러 전용 패키지를 `dependencies` 에 추가하면 모든 다운로드가 조용히
   다시 무거워진다.** 확인 방법:

   ```bash
   pnpm build
   grep -oh 'require("[^".][^"]*")' out/main/index.js out/preload/index.js | sort -u
   ```

   여기 나오는 것만 `dependencies` 에 있으면 된다.

2. **better-sqlite3 의 빌드 잔해를 제외했다.** 런타임에 필요한 건 1.8 MB 짜리
   `.node` 하나인데 패키지는 중간 오브젝트 파일과 SQLite C 원본까지 20 MB 를
   들고 온다. `electron-builder.yml` 의 `files` 제외 규칙 참조.

크기를 건드렸으면 **반드시 패키징된 앱을 실행해서** 확인한다. 전이 의존성 하나만
빠져도 시작조차 못 한다.

---

## 6. 자동 업데이트 동작

`src/main/features/updater/index.ts`.

- **자동 다운로드 안 함.** mac 업데이트는 ~95 MB 다. 테더링 중인 학생이 나중에
  알게 되면 안 된다. 버튼을 눌러야 받는다.
- **자동 설치 안 함.** 재시작 시점은 항상 학생이 고른다.
- 시작 10초 뒤 1회, 이후 6시간마다 확인.
- 오프라인·릴리스 없음은 **정상 상태**로 취급해 조용히 넘어간다. 강의실 노트북은
  절반쯤 오프라인이라, 이걸 에러로 띄우면 알림이 소음이 된다.
- `app.isPackaged` 가 false 거나 `app-update.yml` 이 없으면 phase 가
  `unsupported` 가 되고 UI 가 통째로 숨는다. 타이머도 멈춘다.

UI 는 두 군데다. 워크스페이스 토스트는 끼어들 가치가 있는 두 상태
(`available`, `ready`) 에만 뜨고, 나머지 전부는 설정 → About 에 있다.

### 검증 — 두 버전이 실제로 있어야 한다

자동 업데이트는 **한 번도 진짜로 테스트하지 않으면 반드시 실패하는** 종류다.

1. `v0.2.0` 릴리스 → 설치 → 실행
2. `v0.2.1` 릴리스
3. 1번 앱에서 설정 → About → **업데이트 확인**
4. 토스트가 뜨는가 → 퍼센트가 오르는가 → 재시작 후 **버전이 0.2.1 인가**

**mac 과 Windows 양쪽에서** 돌린다. Squirrel.Mac 과 NSIS 는 완전히 다른
구현이라 한쪽 성공이 다른 쪽을 보장하지 않는다.

---

## 7. 네이티브 모듈은 재빌드하지 않는다

`postinstall` 훅은 없으며, `better-sqlite3`을 포함한 네이티브 의존성은 플랫폼별 Node-API prebuild만 사용하고 로컬 node-gyp/Electron ABI 재빌드는 하지 않는다.

---

## 8. Windows 서명

아직 안 했다. 자동 업데이트는 미서명이어도 정상 동작하지만, 첫 설치 때
SmartScreen 이 "알 수 없는 게시자" 경고를 띄운다. 웹사이트가 이 사실을 그대로
안내한다 (`bandal-web` 의 `RELEASE.windowsSigned`).

붙일 때는 `electron-builder.yml` 의 `win:` 아래에 `azureSignOptions`
(Azure Trusted Signing, 월 $9.99) 또는 `certificateFile` 을 추가하면 되고, 다른
건 바뀌지 않는다. Azure Trusted Signing 개인 개발자 가입은 2025-10 기준 미국·
캐나다 거주자만 가능하다.
