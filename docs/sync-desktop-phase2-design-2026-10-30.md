# 반달 데스크톱 동기화 — 2단계 설계안

- 작성일: 2026-10-30
- 기준: `main` 06fa9b5
- 근거 문서
  - 1단계 보고서 `docs/sync-desktop-survey-2026-10-29.md`
  - 공통 스펙 v2(2026-10-30)
  - iPad 1단계 조사 `bandal-iPad:docs/ipad-sync-phase1-survey-2026-10-29.md`
- 범위
  - 설계만 했다. 앱 코드는 바꾸지 않았다.
  - 산출물로 `sync-fixtures/` 초안을 함께 냈다.
  - 실험 브랜치는 만들지 않았다. 읽기 전용 확인과 외부 조회 3건만 했다(부록 A).
- 표기
  - 위치는 `파일:줄`로 적는다.
  - iPad 저장소는 `bandal-iPad:`, 웹사이트 저장소는 `bandal-web:`를 앞에 붙인다.

---

## 0. 요약

1. **구조는 네 부분이다.** 모두 `src/main/features/sync/` 아래에 둔다.
   - 루프(engine)
   - 로컬↔스펙 변환(adapter)
   - 순수 머지(merge)
   - 제공자(iCloud, Drive)

   제공자는 "루트 안 파일을 읽고 쓰고, 변화를 알리는 일"만 한다. 로컬 변경은 SQLite 트리거가 `sync_outbox`에 적으므로 기존 repo 코드는 거의 건드리지 않는다.
2. **필기 포맷은 `pdf_drawings` 행 그대로다.** `data`·`style` 객체를 그대로 싣고 `id, kind, page, t, created, del`만 더한다. 두 앱이 이미 같은 행 포맷과 같은 V5 형상을 쓰므로 변환 코드가 필요 없다. 색은 이름 토큰 7종을 권한다.
3. **"굵기 1.6배"는 V5끼리의 차이가 아니다.**
   - 원인은 스펙 v1의 근사식 `width×(0.5+p)`와 V5의 차이였다. p=0.5에서 V5 계수는 0.6306이고 근사식은 1.0이다.
   - 데스크톱 V5 공식(`src/shared/inkV5.ts:54`)은 iPad와 같다. 따라서 inkVersion을 그대로 넘기면 차이가 0이다.
   - 이 기준값을 `sync-fixtures/render/v5-diameter.json`에 고정했다.
4. **노트 충돌을 판정하려면 `md_base`(편집을 시작한 버전의 해시)가 필요하다.** 스펙 v2만으로는 "양쪽이 각자 고쳤는지"를 구별하지 못한다. 반례는 14장 P1에 있다. 가장 중요한 변경 제안이다.
5. **로그인 게이트는 없애고, 로그인은 기능 단위로 요구한다.** 다만 AI는 반달 서버를 쓰지 않는다. AI는 사용자 자신의 Claude/Codex/Gemini 계정으로 동작한다. 그래서 "AI만 로그인"을 하려면 정책 게이트를 새로 만들어야 한다. 이 결정이 필요하다(D4).
6. **데이터 루트 이동은 복사 → 검증 → DB 경로 재작성 → 전환 순서로 한다.** 각 단계는 저널에 남겨 롤백할 수 있다. 옛 폴더는 손대지 않는다.
   - 경로를 다시 써야 하는 곳은 DB 4곳과 `settings.json`이다.
   - Claude 세션 재개에도 영향이 있다(9.4).
7. **Apple 웹 로그인은 authorize 단계까지 정상이다.**
   - Supabase는 `client_id=app.bandal.web`, `redirect_uri=https://auth.bandal.io/auth/v1/callback`으로 보낸다.
   - Apple은 이 조합에 정상 로그인 화면을 냈다. 가짜 client_id에는 `invalid_client`를 냈다.
   - 토큰 교환(시크릿 JWT)은 사람이 실제로 로그인해 봐야 확인할 수 있다.
8. **Google 데스크톱 클라이언트 `565020221852-c8mv…`는 이미 Gmail에 쓰이고 있다.**
   - ID는 두 곳에 있다. git이 무시하는 `.env.development.local`·`.env.production.local`, 그리고 Actions secret `MAIN_VITE_GMAIL_CLIENT_ID`다.
   - **시크릿은 어디에도 없다.** 시크릿 없이 교환을 시도하자 Google 토큰 엔드포인트가 `client_secret is missing.`을 돌려줬다.
   - 따라서 Drive에는 시크릿이 필요하다. 지금의 Gmail 연결도 실패할 가능성이 높다. 시크릿은 사람이 콘솔에서 새로 추가한다.
9. **macOS 26.2의 `brctl`에는 `download` 명령이 없다.**
   - 이 셸에서 dataless 파일을 읽으면 `cat`, Node 모두 즉시 `EDEADLK`("Resource deadlock avoided")가 났다.
   - 그래서 미다운로드 파일 처리는 3단계 첫 실험으로 정한다. 패키징된 Electron에서 직접 읽어 보고, 안 되면 Swift 헬퍼를 쓴다.
10. **브리프의 전제 하나를 바로잡는다.**
    - SQLite `bandal.db`는 이미 `~/Library/Application Support/bandal/`에 있어 iCloud 대상이 아니다.
    - iCloud가 비워 버리는 것은 과목 폴더의 파일이다. 142개 중 83개이고, PDF와 `.bandal/COURSE.md` 등이 포함된다.
    - 이 근거만으로도 이동 결정은 그대로 유효하다.
11. **새 데이터 루트는 `<userData>/Courses`다.**
    - userData 폴더 이름은 `bandal`이다. APFS는 대소문자를 구분하지 않으므로 `~/Library/Application Support/Bandal`과 같은 폴더다.
    - 따라서 새 루트는 그 아래 `Courses/`가 된다. 프로필이 이미 쓰는 구조(`profiles/<id>/Courses`)와도 같다.
12. 결정이 필요한 항목은 15장에 13건으로 모았다.

---

## 1. 이번에 새로 확인한 사실

| # | 항목 | 결과 | 근거 | 설계 영향 |
|---|---|---|---|---|
| F1 | Google 데스크톱 클라이언트 | `MAIN_VITE_GMAIL_CLIENT_ID` = `565020221852-c8mv…`. 위치는 `.env.development.local`, `.env.production.local`, Actions secret(2026-09-09), `.github/workflows/release.yml:241`. 시크릿 변수는 없다. `docs/mail-and-presentations.md:16`에 "client_secret을 앱에 포함하지 않는다"고 적혀 있다 | 토큰 엔드포인트에 가짜 code로 PKCE 교환을 보냈더니 `{"error":"invalid_request","error_description":"client_secret is missing."}` | 데스크톱 클라이언트 시크릿을 빌드에 넣는다. Google은 설치형 앱의 시크릿을 기밀로 취급하지 않는다. Gmail(`MAIN_VITE_GMAIL_VERIFIED=false`)도 같은 수정이 필요하다 |
| F2 | Apple 웹 플로우 | 두 호스트 모두 302 → `appleid.apple.com/auth/authorize?client_id=app.bandal.web&redirect_uri=https://auth.bandal.io/auth/v1/callback&response_mode=form_post…` | Apple 응답 비교: 실제 client_id는 132KB 로그인 화면, 가짜 client_id는 11KB `invalid_client` 화면 | Services ID와 리턴 URL은 맞다. 남은 일은 시크릿 JWT 검증(사람 로그인)과 만료 관리(최대 6개월) |
| F3 | `brctl download` | macOS 26.2(25C56)의 `brctl` 명령은 diagnose, log, dump, status, accounts, monitor, spotlight뿐이다. download·evict가 없다. `fileproviderctl`에도 materialize가 없다 | `brctl --help`, `fileproviderctl` | 브리프의 "brctl download" 경로는 쓸 수 없다. 대안은 2.4 |
| F4 | dataless 파일 읽기 | `Aerodynamics#6.pdf`: size 1,523,279, blocks 0, flags `compressed,dataless`. 이 셸에서는 `cat`과 Node `readFileSync` 모두 `EDEADLK`(-11) | `stat -f`, 직접 읽기 | 감지는 `size>0 && blocks==0`으로 한다. 샌드박스 프로세스만 막히고 일반 앱은 읽으면 내려받는다는 보고가 있다(참고 자료). 앱 프로세스 실측이 3단계 첫 실험이다 |
| F5 | SQLite 위치 | `~/Library/Application Support/bandal/bandal.db`(WAL). `~/Documents/Bandal`에는 `.db`·`.sqlite` 파일이 없다 | `ls`, `find` | 이동 근거를 "과목 파일이 비워져 열리지 않음"으로 고친다 |
| F6 | userData | `~/Library/Application Support/bandal`(package name `bandal`). `.../Bandal`은 같은 폴더다(APFS 대소문자 무시) | `ls -d` | 새 데이터 루트 = `<userData>/Courses` |
| F7 | DB 속 절대 경로 | `courses.folder_path` 11, `material_tree_snapshots.folder` 10, `material_added_baselines.folder` 6, `agent_sessions.launch_config_json` 9(cwd), `message_blocks.payload_json` 31(대화 기록). 그 밖에 `settings.json`의 dataRoot | 모든 TEXT 열을 `LIKE '%/Documents/Bandal%'`로 읽기 전용 조회 | 9장의 재작성 대상 |
| F8 | Claude 세션 | `~/.claude/projects/-Users-iseojun-Documents-Bandal-…` 폴더가 있다. Claude Code는 cwd별로 세션을 저장한다 | `ls` | 폴더를 옮기면 `--resume`이 실패할 수 있다(9.4) |
| F9 | 굵기 1.6배 | 데스크톱 `baseDiameterFactorV5` = `(0.24 + 0.68·p^0.8)(1 − 0.12·speed)` (`src/shared/inkV5.ts:54`). iPad `NativePDFInkGeometryV5.swift:149-161`과 같다. 렌더러는 inkVersion으로 고른다(`src/renderer/src/features/ink/inkGeometry.ts:186`) | 데스크톱 코드로 계산: p=0.5 일정 압력 획의 중간 계수 0.630557 | 5장 |
| F10 | 과목 색 | `courses.color`는 토큰이다(blue, gold, green, orange, pink …). 필기 색 토큰과는 다른 팔레트다 | DB 조회 | course.upsert의 color는 토큰 그대로 |
| F11 | storageKey | supabase-js 기본 키 = `sb-<호스트 첫 라벨>-auth-token` (`node_modules/@supabase/supabase-js/dist/index.cjs:622`) | 코드 | URL을 `auth.bandal.io`로 바꾸면 키가 `sb-auth-auth-token`이 되어 모든 세션이 사라진다. 바꾼다면 `storageKey`를 고정한다(7.7) |
| F12 | 숨김 경로 | `materials_index`에 `.bandal/…` 등 숨김 경로가 13행 있다(`materialsRepo.ts:139-140`의 상태 행 포함). 과목 폴더마다 `.bandal/COURSE.md`, `README.md`, `learning/`이 있다 | DB 조회, `ls` | 동기화 대상에서 숨김 경로를 뺀다 |
| F13 | 서버 쓰기 스위치 | `bandal_sync_configuration.enforce_paid_access`가 있다(`supabase/migrations/20261015020000_sync_paid_access.sql:15-19`). 그러나 결제자는 계속 쓸 수 있어 전면 중단 스위치가 아니다 | 마이그레이션 | 8.4에서 따로 막는다 |
| F14 | 웹사이트 | `bandal-web`(Astro, Vercel). `src/content/sync.ts`가 status `available`, 월 4,900원, 연 49,000원이다 | 레포 grep | 8.6 수정안 |

---

## 2. 아키텍처

### 2.1 구성

```text
renderer  설정 › 동기화 · 초기 연결 대화상자 · 상태 표시 ──IPC sync:*──┐
main                                                                   │
  SyncEngine (활성 프로필당 1개) ◄─────────────────────────────────────┘
    ├ SyncAdapter   로컬 DB·과목 폴더 ↔ 스펙 v2 (export / apply)
    ├ merge         순수 함수: 파싱한 원격 파일 → 승자
    └ SyncProvider  iCloudProvider | DriveProvider (루트 파일 I/O + 변화 감지)
  기존 repo (courses, materials, drawings, notes) ── SQLite 트리거 ──► sync_outbox
```

### 2.2 파일 배치(3단계 기준)

```text
src/main/features/sync/
  engine.ts          루프, 상태, idle 감지, 백오프
  adapter.ts         export(outbox → 파일), apply(머지 결과 → DB·파일)
  merge.ts           순수 머지. merge.test.ts가 sync-fixtures/를 돌린다
  format.ts          경로 규칙, 파일 이름 파싱, 스키마 검증
  clock.ts           t 발급
  identity.ts        device_id, seq, 기기 지문
  providers/icloud.ts
  providers/drive.ts
src/main/features/google/oauth.ts   gmailService의 loopback+PKCE를 꺼내 Gmail·Drive가 함께 쓴다
src/renderer/src/features/sync/     SyncSettingsPanel.tsx, InitialConnectDialog.tsx
```

### 2.3 SyncProvider

구현이 둘(iCloud, Drive)이라 인터페이스를 둔다. 크기는 최소로 한다.

```ts
export interface RemoteEntry {
  path: string          // 루트 기준 상대 경로, '/' 구분
  version: string       // iCloud: `${mtimeMs}:${size}`, Drive: md5Checksum 또는 headRevisionId
  size: number
  materialized: boolean // iCloud dataless면 false
}

export interface SyncProvider {
  readonly kind: 'icloud' | 'gdrive'
  open(): Promise<{ status: 'ready' | 'needs-ipad' | 'needs-auth' | 'unavailable'; account?: string }>
  changes(cursor: string | null): Promise<{ entries: RemoteEntry[]; cursor: string }>
  read(path: string): Promise<Buffer>               // 내려받기 대기와 타임아웃 포함
  write(path: string, bytes: Buffer): Promise<void> // 원자적. 자기 기기 파일만 쓴다
  watch(onHint: () => void): () => void             // 변화 힌트. 해제 함수를 돌려준다
}
```

### 2.4 iCloudProvider

| 항목 | 설계 |
|---|---|
| 루트 | mac `~/Library/Mobile Documents/iCloud~app~bandal/Documents`. Windows `%USERPROFILE%\iCloudDrive\iCloud~app~bandal\`(설정에 "실험적"으로 표시) |
| 폴더가 없을 때 | 직접 만들지 않는다. 상태를 `needs-ipad`로 두고 "iPad에서 먼저 iCloud 동기화를 켜 주세요" + [다시 확인]을 보여 준다. Mac에서 iCloud Drive 자체가 꺼져 있으면(`~/Library/Mobile Documents/com~apple~CloudDocs`가 없음) "시스템 설정에서 iCloud Drive를 켜 주세요"를 보여 준다 |
| 쓰기 | 임시 파일을 루트 **밖**인 `<userData>/sync/tmp/`에 쓰고 `fs.rename`으로 옮겨 넣는다. 같은 볼륨이라 원자적이다. 임시 파일이 업로드될 일이 없으므로 `.nosync` 규칙에 기대지 않는다 |
| 목록 | `fs.readdir(root, { recursive: true })`. macOS 14 이후에는 dataless 파일도 원래 이름으로 보인다. 예전 형식인 `.<name>.icloud`가 보이면 `<name>`으로 바꾸고 `materialized=false`로 둔다 |
| dataless 감지 | `stat.size > 0 && stat.blocks === 0`(F4 실측) |
| 읽기 | ① 먼저 그냥 읽는다. 일반 앱은 읽기에서 내려받기가 일어난다는 보고가 있다. ② `EDEADLK`가 나거나 60초를 넘기면 네이티브 헬퍼에 내려받기를 요청한다. 헬퍼 `bandal-icloud-helper materialize <path>`는 `NSFileCoordinator` 읽기나 `FileManager.startDownloadingUbiquitousItem`을 쓴다. 기존 `scripts/build-native.mjs`에 Swift 도구 하나를 더하면 된다. ③ 감시로 `blocks>0`이 되기를 기다렸다가 다시 읽는다. 동시에 2개까지만 처리한다. 실패한 파일은 "대기"로 두고 다음 주기에 다시 시도한다. **내려받지 못한 파일을 없는 파일이나 빈 파일로 보지 않는다** |
| 감시 | `fs.watch(root, { recursive: true })`(표준 라이브러리, macOS FSEvents·Windows ReadDirectoryChangesW) → 1초 디바운스 → `changes()`. 이벤트 누락에 대비해 5분마다, 그리고 창에 포커스가 올 때 전체를 다시 스캔한다 |
| cursor | 마지막 스캔의 `{path: version}` 해시. iCloud에는 서버 커서가 없다 |
| Windows | Cloud Files 플레이스홀더는 읽으면 내려받아진다. 오프라인이면 오류가 나므로 대기로 둔다. 설정 화면에 "Windows에서는 Google Drive를 권장합니다"를 보여 준다 |

**엔타이틀먼트(Developer ID 프로파일 + iCloud)는 v1에서 쓰지 않는다.**

쓰지 않는 이유:
- iCloud 엔타이틀먼트는 프로파일 승인이 필요하다. Developer ID로 서명한 앱에서 iCloud capability가 동작하지 않았다는 포럼 보고가 있다.
- Node에서는 어차피 `NSFileCoordinator`/`NSMetadataQuery`를 바로 쓸 수 없다.
- 잘못 넣으면 실행 자체가 막힌다(AMFI).

비용 조사 결과:
- Developer ID 프로파일은 만료가 사실상 없다.
- 데스크톱 App ID를 같은 팀(VUZ7Z98BW3)에 만들고 컨테이너를 공유해야 한다.
- `embedded.provisionprofile`, entitlements 추가, 서명 스크립트 수정이 필요하다.
- 얻는 것은 헬퍼 없이 조정된 읽기를 할 수 있다는 정도다.

### 2.5 DriveProvider

| 항목 | 설계 |
|---|---|
| OAuth | 시스템 브라우저 + loopback(`127.0.0.1:<임의 포트>`) + PKCE(S256) + state. 이미 있는 `src/main/features/mail/gmailService.ts:131-157` 흐름을 `features/google/oauth.ts`로 옮겨 쓰고, 토큰 교환에 `client_secret`을 더한다(F1). 스코프는 `https://www.googleapis.com/auth/drive.file` 하나다. `access_type=offline`을 쓰고 `prompt=consent`는 첫 연결 때만 쓴다. Supabase 로그인과는 무관하다 |
| 계정 표시 | `about.get?fields=user(emailAddress,displayName)`. drive.file 스코프로 되는지는 PR6에서 확인한다. 안 되면 표시만 생략한다. 이것 때문에 스코프를 늘리지 않는다 |
| 토큰 | `<userData>/sync/gdrive-token.enc`. `sessionStore.ts`와 같은 방식이다(safeStorage 암호화, 원자적 쓰기, 권한 0600). 암호화를 쓸 수 없으면 메모리에만 두고 다음 실행 때 다시 연결한다. 평문 파일은 만들지 않는다 |
| 루트 | `files.list(q="name='Bandal' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false")`. drive.file 스코프라 앱이 만든 폴더만 보인다. 만들 때 `appProperties.bandalRoot='2'`를 단다. 같은 폴더가 여러 개면 `bandal.json`이 있고 `createdTime`이 가장 이른 것을 쓴다 |
| 트리 | 스펙의 경로를 폴더로 그대로 만든다. 경로→폴더 id는 `<userData>/sync/gdrive-ids.json`에 캐시한다. 캐시를 잃으면 목록 조회로 다시 만든다 |
| 자기 파일 | 경로→fileId를 기억한다. 덮어쓰기는 `files.update`(media)다. 새 파일은 `files.create`로 만들고, 5MB 이하는 multipart, 그 이상은 resumable로 올린다. resumable 세션 URI는 저널에 남겨 재시작 후 이어 올린다. 맵을 잃었으면 같은 이름의 파일을 먼저 찾아 중복 생성을 막는다 |
| 같은 이름 중복 | 다른 기기의 같은 이름 파일이 둘이면 `modifiedTime`이 늦은 쪽을 쓴다 |
| 변화 감지 | `changes.getStartPageToken` → `changes.list(pageToken, spaces=drive, includeRemoved=true, pageSize=1000, fields=…)`. 간격은 스펙대로 활성 30초, 유휴 5분이고 창에 포커스가 오면 즉시 확인한다. "활성"은 창에 포커스가 있고 최근 5분 안에 입력이 있었던 상태다 |
| 오류 | 401 → 토큰을 갱신한다. `invalid_grant` → `needs-auth`로 두고 "Google Drive 연결이 끊겼어요" + [다시 연결]을 보여 준다. 403 `rateLimitExceeded`/`userRateLimitExceeded`, 429, 5xx → 지터를 넣은 지수 백오프(최대 15분). 어떤 오류가 나도 로컬 편집은 막지 않는다 |
| 검증 | 내려받은 PDF와 자산은 파일 이름의 SHA-256과 비교한다. 다르면 버리고 다시 받는다 |
| 연결 해제 | `https://oauth2.googleapis.com/revoke`로 토큰을 폐기하고 토큰 파일을 지운다. 클라우드 파일은 그대로 둔다 |

### 2.6 공통 규칙

- **device_id**
  - 프로필의 `<userData>/sync/state.json`에 둔다. 스펙이 허용한 "로컬 보존" 방식이다.
  - 기기 지문도 함께 저장한다. 지문은 mac `IOPlatformUUID`, Windows `MachineGuid`의 SHA-256이다.
  - 시작할 때 지문이 다르면 새 device_id를 만든다. 마이그레이션 지원이나 백업 복원으로 다른 기기에 복제돼도 두 기기가 같은 파일을 쓰지 않게 하기 위해서다.
- **seq**
  - 기기당 카운터 하나를 모든 파일 종류가 함께 쓴다(P7).
  - `next_seq`는 파일을 쓰기 전에 저장한다.
  - 루트에 연결할 때 자기 기기 파일의 최대 seq를 확인한다. 저장된 값이 그보다 작으면 최대값 + 1로 올린다. 상태 파일을 잃어도 자기 파일을 덮어쓰지 않게 하기 위해서다.
- **세션 파일**
  - 세션은 앱 실행 한 번(프로필 단위)이다.
  - log는 세션당 1개, ink는 (문서, 페이지)당 1개, 노트는 문서당 1개다.
  - 세션 안에서는 자기 파일을 다시 쓴다. log와 ink는 1MB를 넘으면 새 파일로 넘어간다.
- **쓰기 순서**
  - 내용 파일(`pdf/`, `assets/`, `ink/`, `notes/`)을 먼저 쓰고, 그것을 가리키는 log를 마지막에 쓴다.
  - 읽는 쪽은 참조 대상이 아직 없으면 "대기"로 두고 다시 시도한다.
- **t 발급**
  - `t = max(Date.now(), remote_max + 1, last_t + 1)`. 스펙 문구에 `last_t + 1`을 더했다(P2).
  - 원격 t가 지금 시각보다 10분 넘게 앞서면 "다른 기기의 시계가 맞지 않아요" 경고를 띄운다. 머지 규칙은 바꾸지 않는다.
- **outbox**
  - 트리거가 `courses`, `pdf_drawings`, `materials_index`(pdf·note)의 INSERT/UPDATE/DELETE를 `sync_outbox(kind, id)`에 적는다.
  - 조건은 `WHEN (SELECT enabled AND NOT applying FROM sync_runtime)`이다. 그래서 원격 적용 중의 쓰기와 동기화가 꺼진 상태의 쓰기는 적지 않는다.
  - IPC, MCP 도구, 파일 감시 중 어느 경로로 바뀌어도 잡힌다.
  - 엔진은 1.5초마다 outbox의 최대 rowid를 본다. 직전 값과 같으면 1.5초 동안 변화가 없었다는 뜻이므로 내보낸다. 이렇게 스펙의 "1.5초 idle"을 맞춘다.
  - outbox는 "후보"일 뿐이다. 내보낼 때 마지막 동기화 상태와 내용을 비교하고, 같으면 아무것도 쓰지 않는다. 두 가지 문제를 여기서 막는다.
    - 원격 적용으로 생긴 파일이 다시 감지되어 되돌아 나가는 메아리
    - 기기 간 시계 차이
- **상태 저장**: 프로필 DB에 migration v39로 아래 테이블을 만든다.

  | 테이블 | 용도 |
  |---|---|
  | `sync_runtime(enabled, applying)` | 트리거 조건(1행) |
  | `sync_outbox(kind, id)` | 로컬 변경 후보 |
  | `sync_meta(entity_id, field, value_json, t, device_id)` | 과목·문서 필드 레지스터 |
  | `sync_docs(document_id, course_id, rel_path, name, type, content_hash, missing_since)` | 문서 ID와 로컬 경로의 대응 |
  | `sync_alias(kind, remote_id, local_id)` | 초기 연결 때 이름으로 합친 과목 |
  | `sync_ink(id, t, device_id, content_hash)` | 개체별 마지막 동기화 버전 |
  | `sync_note_versions(document_id, md_hash, md_base, t, device_id, file)` | 노트 버전 그래프 |
  | `sync_files(path, version)` | 이미 처리한 원격 파일 |

### 2.7 루프

```text
start(profile)
  → provider.open()   needs-ipad / needs-auth면 상태만 보여 주고 기다린다
  → 바인딩이 없으면 6.2 초기 연결
loop
  힌트(watch · 폴링 · 창 포커스) → changes() → 새로 생기거나 바뀐 파일만 읽기 → 형식 검사 → merge
    → apply(트랜잭션, applying=1) → renderer에 변경 알림
  outbox가 1.5초 동안 그대로 → export → write → sync_files·sync_ink 등 갱신 → outbox 비우기
  devices/<id>.json의 last_seen: 시작할 때와 1시간마다
```

상태 값: `off · connecting · syncing · synced(at) · offline · needs-auth · needs-ipad · update-required · error(message)`.

---

## 3. SyncAdapter (로컬 ↔ 스펙 v2)

### 3.1 ID 안정화

| 대상 | 방법 |
|---|---|
| course_id | `courses.id`(이미 UUID)를 그대로 쓴다 |
| PDF document_id | `pdf_document_bindings.material_id`가 있으면 그것을 쓴다. 필기 재매핑 같은 기존 코드와 같은 ID를 공유하기 위해서다. 없으면 v39에서 현재 `materials_index.id`를 한 번 복사해 `sync_docs`에 고정한다 |
| md document_id | 같은 방식으로 `sync_docs`에 한 번 고정한다 |
| 경로 재스캔 | 새 경로가 보이면 새 UUID를 만들기 전에 **내용 해시**로 기존 문서를 찾는다. 경로에서 사라진(`missing_since`가 있는) `sync_docs` 행 중 `content_hash`가 같은 것이 있으면 그 ID를 이어 쓰고 이름·경로 변경 이벤트를 낸다. 스펙의 "해시 재매칭"이다 |
| 앱 안에서 이름 변경·이동 | 기존 `repoint`가 ID를 유지한다. `sync_docs`도 같은 트랜잭션에서 갱신한다 |
| 앱 밖에서 삭제 | 두 번 연속 스캔에서 없고, 과목 폴더 자체는 읽을 수 있을 때만 `doc.delete`를 낸다. 외장 드라이브 분리나 내려받기 대기를 삭제로 착각하지 않기 위해서다 |
| 필기 개체 id | `pdf_drawings.id`를 그대로 쓴다 |

### 3.2 과목

| 스펙 필드 | 로컬 |
|---|---|
| name | `courses.name` |
| sort | `courses.sort_order` |
| color | `courses.color`(토큰 그대로) |
| archived | `courses.archived`(0/1 ↔ bool) |
| (없음) | `slug`, `folder_path`, `group_id`(과목 그룹), `source`는 기기에만 둔다 |

- 원격 과목이 오면 관리형 폴더 `<dataRoot>/<slug>`를 만든다.
- 연결형 과목(`source='linked'`, 외부 폴더)은 v1에서 동기화하지 않는다. 목록에는 "동기화 안 함"으로 표시한다(D5).
- `course.delete`를 받으면 과목을 소프트 삭제만 하고 과목 폴더는 남긴다. 앱 안에서 과목을 지울 때와 같다(2026-11-01 확정, 19장).

### 3.3 문서

- **대상**: `materials_index.kind`가 `pdf`와 `note`(.md)인 것. 경로의 어느 구간이든 `.`으로 시작하면 뺀다(F12).
- **필드**(P3)
  - `rel_path`: 과목 안 폴더 경로. 루트는 `""`, 구분자는 `/`, NFC로 정규화한다.
  - `name`: 확장자를 포함한 파일 이름. NFC로 정규화한다.
  - `pdf_sha256` / `md_hash`: 파일 바이트의 SHA-256.

  폴더와 이름을 나눠 두면 이름 변경과 폴더 이동이 동시에 일어나도 둘 다 보존된다.
- **원격 문서 받기**
  1. `sync_docs` 행을 먼저 만든다.
  2. 내용을 내려받아 과목 폴더에 `writeFileAtomic`으로 쓴다.
  3. 재스캔은 이미 아는 경로·해시라서 새 이벤트를 내지 않는다.

  같은 경로에 다른 로컬 파일이 있으면 `이름 (2).확장자`로 쓴다. v1에서는 이 이름이 그대로 동기화된다.
- **원격 삭제**: `doc.delete`를 받으면 로컬 파일을 OS 휴지통으로 옮긴다.
- **PDF가 앱 밖에서 바뀐 경우**(같은 경로, 다른 sha): 같은 document_id에 `pdf_sha256`만 갱신한다. 두 앱의 기존 보호("PDF 원본이 기존 필기와 다릅니다")가 그대로 동작하고, 필기는 남는다.
- **PDF 업로드**: `pdf/<sha256>.pdf`가 없을 때만 올린다(중복 업로드 금지).

### 3.4 필기 개체 JSON (iPad 팀과 합의할 초안, P4)

원소 하나가 `pdf_drawings` 1행이다.

| 키 | 타입 | 출처 | 설명 |
|---|---|---|---|
| `id` | 소문자 UUID | `id` | |
| `kind` | `ink`, `highlighter`, `rect`, `ellipse`, `arrow`, `line`, `textbox`, `image` | `kind` | `clip`(보드 전용 참조)은 v1에서 뺀다 |
| `page` | 1 이상의 정수 | `page` | 문서의 `pdf_sha256` 기준 쪽 번호 |
| `t` | 정수 ms | `updated_at` | 승자 판정 |
| `created` | 정수 ms | `created_at` | 그리기 순서는 `(created, id)` |
| `data` | 객체 | `data_json` 그대로 | `inkVersion`, `points[{x,y,p,t?,tiltX?,tiltY?}]`, `box`, `text`, `textRuns`, `image` |
| `style` | 객체 | `style_json` 그대로 | `color`(토큰 7종), `width`(표시 페이지 폭에 대한 비율), `opacity`, `fixedWidth?`, 글상자 서식 |
| `del` | `true`(선택) | `deleted_at`이 있으면 | del 버전도 마지막 내용을 함께 담는다 |

- **필수 항목과의 대응**: 스펙의 "color, width, 압력 포함 점 배열"은 각각 `style.color`, `style.width`, `data.points[].p`에 있다.
- **좌표**: 회전을 반영한 CropBox 기준 0–1이다. 데스크톱 개체는 경계를 조금 넘을 수 있다. 받는 쪽은 거부하지 말고 그릴 때 잘라 낸다(P4). iPad는 지금 [0,1] 밖을 거부한다.
- **색**: 이름 토큰 7종이다(D7). 두 앱 모두 토큰만 만들고 저장하므로 왕복해도 손실이 없다. hex는 다른 엔진을 위해 스펙 표에만 적는다.
  - `ink` #14171F, `red` #D6242E, `orange` #F06314, `yellow` #F5B80A
  - `green` #1A944D, `blue` #1461E0, `violet` #7D36D1
- **숫자**: 지금은 저장값(배정밀도)을 그대로 쓴다. 측정해서 용량이 문제가 되면 P11(좌표 소수 6자리)을 적용한다.
- **알 수 없는 키**: 무시한다. 개체를 고쳐 다시 쓸 때는 알려진 키만 쓴다. 형식이 바뀌면 format으로 막는다.

```json
{"id":"e0000000-0000-4000-8000-000000000001","kind":"ink","page":1,"t":1793318402000,"created":1793318402000,
 "data":{"inkVersion":5,"points":[{"x":0.2,"y":0.3,"p":0.25,"t":0},{"x":0.204,"y":0.301,"p":0.4,"t":4}]},
 "style":{"color":"ink","width":0.003,"opacity":1}}
```

### 3.5 이미지 (assets)

- **내보내기**
  1. `data.image.relPath` 파일을 읽어 SHA-256을 계산한다.
  2. `assets/<sha>.<ext>`가 없으면 올린다.
  3. 개체에 `data.image.sha256`을 더한다. `relPath`는 원래 위치를 알려 주는 힌트로 남긴다.
- **받기**
  - 힌트 경로에 같은 해시의 파일이 있으면 그대로 쓴다.
  - 없으면 자산을 내려받아 `images/<label>`에 쓴다. `images/`는 데스크톱 기본 폴더다(`PdfPageView.tsx:50`). 이름이 겹치면 번호를 붙인다.
  - 그다음 로컬 `relPath`를 바꾼다.
  - 자산이 아직 도착하지 않았으면 기존 "불러오는 중/없음" 표시를 쓴다.
- 이미지 파일 자체는 문서로 동기화하지 않는다. v1 문서 종류는 pdf와 md뿐이다.

### 3.6 md 노트

- **스냅샷**: 파일 바이트 전체를 `notes/<doc>/<device>-<seq>.md`에 쓴다. 세션 안에서는 같은 파일을 다시 쓴다.
- **이벤트**: `doc.upsert {md_hash, md_base, md_assets?}`
  - `md_base`: 편집을 시작한 버전의 해시(P1).
  - `md_assets`: 본문 속 상대 경로 이미지 → `<sha>.<ext>`의 대응(P5). iPad 1단계 조사 §3.1의 `assets` 배열 제안과 같은 방향이다.
  - 본문은 고치지 않는다.
- **받기**
  - 이긴 버전(head)을 로컬 `.md`에 원자적으로 쓴다.
  - 단, 로컬 파일이 마지막 동기화 뒤에 바뀌었다면 바로 덮지 않는다.
    1. 로컬 내용을 먼저 내보낸다. 이 내용이 새 head가 된다.
    2. 그다음 머지한다.
    3. 충돌이면 4.2 규칙을 따른다.
- **열린 편집기**
  - 편집 중이 아니면 파일을 다시 읽는다.
  - 편집 중이면 위 순서로 처리한 뒤 "다른 기기의 변경이 있어 충돌 사본을 만들었어요" 알림을 띄운다. 덮어쓰기는 기존 `expectedMtime` 검사가 막는다.
- **충돌 사본**
  - 이름은 `<이름> (충돌 사본 <기기명>).md`이고 원래 노트와 같은 폴더에 둔다.
  - id는 `uuidv5(NS, "<document_id>:<진 쪽 md_hash>")`로 정해지므로 모든 기기가 같은 사본을 계산한다.
  - 누군가 고치거나 지우기 전까지는 파생 문서다. 처음 손댄 기기가 일반 문서처럼 이벤트를 낸다.
- **본문 속 연결 주석**: `<!-- bandal:pdf-page-note … -->`는 본문이라 그대로 전달된다. 연결 정보 자체(`material_links`)는 v1에서 동기화하지 않는다.

### 3.7 v1에서 동기화하지 않는 것

- 텍스트 하이라이트(`annotations`)
- 과목 그룹, 즐겨찾기, `material_links`
- 보기 위치(`pdf_view_state`)
- 화이트보드
- pdf·md가 아닌 파일(이미지, PPT 등)
- 녹음, AI 대화, 설정
- 연결형 과목

목록에 "이 기기에만 있음" 표시가 필요한지는 3단계 UI에서 정한다.

---

## 4. 머지 엔진

### 4.1 형태

- `merge(files: ParsedFile[]): MergedState`는 순수 함수다.
- `ParsedFile`은 `{path, author(device_id), kind, seq, payload}`다. author는 파일 경로에서 읽는다. 이벤트 안에는 없다.
- 파일 도착 순서와 상관없이 결과가 같아야 한다. 교환·결합·멱등 법칙을 만족해야 한다.
- 실제 실행은 증분이다. 레지스터(`sync_meta`, `sync_ink`, `sync_note_versions`)에 최대값만 합치므로 같은 파일을 다시 읽어도 안전하다.

### 4.2 규칙

| 대상 | 규칙 |
|---|---|
| 과목·문서 필드 | `(entity, field)`마다 레지스터 하나. 값은 `(t, device_id)`가 가장 큰 것이다. t가 같으면 device_id가 사전순으로 큰 쪽이 이긴다(P2) |
| 삭제 | `deleted` 레지스터. `*.delete`는 `(true, t)`, `*.upsert`는 `(false, t)`이고 같은 최대값 규칙을 따른다 |
| 필기 | 개체 id마다 `(t, device_id)`가 가장 큰 버전 **전체**를 쓴다. del도 하나의 버전이다. 한 파일 안에 같은 id가 둘이면 t가 큰 것을 쓴다 |
| 노트 | `doc.upsert`의 `(md_hash, md_base, t, author)`로 버전 그래프를 만든다. 다른 버전의 base로 쓰이지 않은 버전이 head다. head가 하나면 그것이 본문이다. 여럿이면 `(t, device_id)`가 가장 큰 것이 본문이고 나머지는 충돌 사본이다. 자손은 항상 조상보다 t가 크므로 본문은 `md_hash` 레지스터의 승자와 언제나 같다 |
| 내용 위치 | 버전의 내용은 `notes/<doc>/<author>-*.md` 중 해시가 맞는 파일이다. seq가 큰 파일부터 찾는다. 없으면 대기한다 |
| 형식 | `bandal.json`의 format이 2보다 크면 루트 전체를 읽기 전용으로 두고 "앱 업데이트 필요"를 보여 준다. 기기별 format(P6)이 2보다 크면 그 기기의 파일만 무시하고 같은 안내를 보여 준다 |
| 모르는 것 | 모르는 op는 무시한다. 모르는 필드는 레지스터에 보관하되 적용하지 않는다 |
| 표시 규칙 | 삭제된 과목에 살아 있는 문서가 있으면 과목을 표시한다(파생 규칙, P8). 문서가 없는 필기는 숨기되 자료는 유지한다 |

### 4.3 테스트 목록

모두 `merge.test.ts`(단위 테스트)에서 다룬다. 픽스처가 있는 경우는 `sync-fixtures/`로도 확인한다.

| # | 경우 | 기대 | 픽스처 |
|---|---|---|---|
| M01 | 과목·PDF·노트·필기 각 1 | 그대로 재현 | 01 |
| M02 | 같은 과목의 이름을 양쪽에서 바꿈 | t가 큰 쪽 | 02 |
| M03 | 한쪽은 이름, 다른 쪽은 색을 바꿈 | 필드별로 각자 이김 | 02 |
| M04 | t가 같고 값이 다름 | device_id가 큰 쪽 | 02(S2) |
| M05 | 같은 획을 한쪽은 이동, 다른 쪽은 색 변경 | t가 큰 쪽의 개체 전체 | 02(S1) |
| M06 | 문서 삭제 뒤 더 큰 t로 이름 변경 | 복구 + 새 이름 | 03(D1) |
| M07 | 이름 변경 뒤 더 큰 t로 삭제 | 삭제 유지, 필드 값은 보존 | 03(D3) |
| M08 | 획 del 뒤 더 큰 t로 이동 | 복구 | 03(S1) |
| M09 | 획 이동 뒤 더 큰 t로 del | 삭제 | 03(S2) |
| M10 | 노트를 차례로 편집(A→B→A) | 충돌 없음 | 04(N1) |
| M11 | 노트를 동시에 편집 | 본문 + 결정적 충돌 사본 | 04(N2) |
| M12 | 세 기기가 동시에 편집 | head 3개 → 본문 1 + 사본 2 | 단위 |
| M13 | 두 기기가 같은 내용으로 편집 | 해시가 같으므로 충돌 없음 | 단위 |
| M14 | 파일 도착 순서를 무작위로 100번 | 모든 순서에서 같은 결과 | 단위(픽스처 4개 재배열) |
| M15 | 같은 파일을 두 번 적용 | 변화 없음 | 단위 |
| M16 | 오프라인 두 기기가 같은 페이지에 획을 N개씩 추가 | 합집합 2N, 손실 0 | 단위(브리프 검토 항목) |
| M17 | log가 가리키는 노트·PDF 파일이 아직 없음 | 대기, 이전 상태 유지 | 단위 |
| M18 | 깨진 JSON / gzip | 그 파일만 대기, 나머지는 진행 | 단위 |
| M19 | format 3 파일 | 무시 + update-required | 단위 |
| M20 | 모르는 op·필드 | op는 무시, 필드는 보관 | 단위 |
| M21 | 삭제된 과목에 다른 기기가 새 문서를 추가 | 과목 표시 | 단위(P8) |
| M22 | 문서가 없는 필기 | 숨김. 문서를 복구하면 다시 보임 | 단위 |
| M23 | t 발급: 로컬 시계가 원격 최대보다 늦음 | `remote_max+1` | 단위(clock) |
| M24 | 상태 파일을 잃고 다시 연결 | seq가 기존 최대 다음부터 | 단위(identity) |
| M25 | 기기 복제(지문 불일치) | 새 device_id | 단위(identity) |
| R01 | V5 지름 계수 | `render/v5-diameter.json`과 1e-6 이내 | render |

---

## 5. 필기 표시와 편집

### 5.1 굵기 1.6배의 원인과 해소

- iPad 조사의 "1.6배"는 같은 width를 두 식으로 그렸을 때의 차이다.
  - 스펙 v1 근사 `width×(0.5+p)`: p=0.5에서 1.0
  - V5: p=0.5에서 0.63
- 데스크톱에는 이미 V5가 있고, 행의 `inkVersion`에 따라 렌더러를 고른다(`inkGeometry.ts:186`). 공식도 iPad와 같다(F9).
- 그래서 **변환 계수 없이** 행을 그대로 넘기면 굵기가 같다.
- 데스크톱 코드로 계산한 기준값을 `sync-fixtures/render/v5-diameter.json`에 넣었다. 압력 램프, 시간 포함 획, 일정 압력, 형광펜의 4건이다. 예를 들어:

  | 경우 | 점별 계수 |
  |---|---|
  | 일정 압력 p=0.5 | 0.4729 · 0.6306 · 0.6306 · 0.6306 · 0.2018(끝 가늘어짐 포함) |
  | 형광펜 | 1(일정 폭) |

### 5.2 남는 차이

| 항목 | 내용 | 대응 |
|---|---|---|
| 입력 압력 보정 | 데스크톱은 포인터 압력 원값을 쓰고, 값이 0이면 0.5로 둔다(`inkGeometry.ts` `normalizedPoint`). iPad는 `clamp(force/max×2.5, 0.25, 1)`이다 | 저장된 p로 그리면 결과가 같다. 같은 힘으로 썼을 때의 체감 차이는 동기화 범위가 아니다 |
| 속도 항 | 데스크톱 펜 입력은 점별 t를 기록하지 않아 속도 항이 중립이다 | 데이터가 같으면 결과도 같다 |
| inkVersion 없는 옛 행 | 데스크톱은 perfect-freehand, iPad는 `NativePDFLegacyInk.swift`로 그린다 | 이 Mac에는 살아 있는 ink 행이 0개다. 옛 행 예제는 PR4에서 하나 더한다 |
| 경계 밖 좌표 | iPad가 거부한다 | P4: 받아 두고 그릴 때 자른다 |

### 5.3 데스크톱 편집

- 기존 편집 기능은 모두 유지한다(이동, 크기, 색, 도형 스냅, 지우개, 실행 취소). 개체가 바뀌면 `updated_at`이 갱신되고, 트리거 → outbox → 새 t로 같은 id를 내보낸다.
- 동시 편집에서는 개체 전체가 t가 큰 쪽으로 이긴다.
  - 예: iPad의 이동과 데스크톱의 색 변경이 겹치면 이동이 사라진다(02 픽스처).
  - 필드 단위 병합은 하지 않는다. 손실은 "같은 획을 동시에 고친 경우 한쪽 변경"에 한정된다.
- 지운 것을 실행 취소하면 데스크톱은 같은 id를 되살리고 iPad는 새 id를 만든다. 둘 다 규칙과 맞는다.

### 5.4 페이지 재구성 차단

- `pdf:restructure`(`registerHandlers.ts:1038`) 앞에서, 문서가 동기화 대상이면 거부한다.
- 안내 문구: "동기화 중인 문서는 페이지를 추가·삭제·이동할 수 없어요. 사본을 만들어 편집하거나 이 문서의 동기화를 끄세요."
- [사본으로 편집]을 누르면 파일을 복사해 새 document_id로 만든다.
- 문제가 하나 있다. **손글씨 노트 PDF에 쪽을 더하는 것도 `pdf:restructure`다**(iPad 조사 §4). 이것까지 막으면 동기화된 노트에 쪽을 더할 수 없다.
- 그래서 "끝에 덧붙이기만 허용"을 제안한다(P9, D6).

---

## 6. 초기 연결, 설정 화면, 제공자 전환, 프로필 바인딩

### 6.1 설정 › 동기화

```text
동기화
  저장소    ○ 끔   ○ iCloud   ○ Google Drive
            (Windows: "iCloud (실험적)" · "Google Drive 권장")
  상태      ● 동기화됨 · 3분 전                     [지금 동기화]
            대기 중인 변경 2건
  계정      iCloud: 이 Mac의 iCloud Drive · 반달 폴더
            Google Drive: user@gmail.com            [연결 해제]
  기기      MacBook Air (이 기기) · iPad Pro — 10분 전
  프로필    '기본' 프로필이 이 저장소와 연결돼 있어요
```

| 상태 | 문구 |
|---|---|
| needs-ipad | "iPad에서 먼저 iCloud 동기화를 켜 주세요" [다시 확인] |
| needs-auth | "Google Drive 연결이 끊겼어요" [다시 연결] |
| offline | "오프라인이에요. 연결되면 이어서 동기화해요" |
| update-required | "다른 기기에서 더 새 반달을 쓰고 있어요. 앱을 업데이트해 주세요" |
| 시계 경고 | "다른 기기의 시계가 맞지 않아요. 날짜와 시간 설정을 확인해 주세요" |

사이드바에는 상태 점 하나만 둔다.

### 6.2 초기 연결

1. 저장소를 고르면 `open()`을 하고, 원격 log를 모두 읽어 요약한다.
2. 상황에 따라 처리한다.
   - **클라우드가 비어 있음**: "이 기기의 과목 N개, 문서 M개를 올립니다" → [시작]. 이때 `bandal.json`을 만든다.
   - **로컬이 비어 있음**: 전부 받는다.
   - **양쪽에 모두 있음**: 대화상자를 띄운다. 선택지는 셋이다.
     - **합치기(기본)**
       - 합집합으로 합친다.
       - 이름이 같은 과목 쌍은 체크 목록으로 보여 준다. 이름은 NFC로 맞추고 앞뒤 공백을 무시해 비교한다.
       - 체크한 쌍만 합치고 `sync_alias`로 잇는다. 로컬 ID는 바꾸지 않는다.
       - 같은 과목 안에서 PDF sha256이 같으면 같은 문서로 본다. md는 해시가 같을 때만 같은 문서다. 이름이 같아도 내용이 다르면 둘 다 남긴다.
     - **이 기기 자료로 덮어쓰기**
       - 원격에만 있는 과목과 문서에 새 t로 tombstone을 낸다.
       - 확인 문구: "다른 기기에만 있는 과목 N개와 문서 M개가 모든 기기에서 사라집니다. 클라우드 파일은 지우지 않습니다."
     - **클라우드 자료 가져오기**
       - 기존 "새 프로필" 기능을 응용한다. 현재 프로필은 그대로 두고, 새 프로필을 이 루트에 연결해 전부 받는다.
       - 로컬 자료를 지우는 동작이 하나도 없다.
       - 확인 문구: "지금 자료는 현재 프로필에 그대로 두고, 새 프로필로 클라우드 자료를 가져옵니다."
3. 진행률은 올린 개수와 받은 개수로 보여 준다. 중간에 멈추면 다음 실행 때 이어서 한다.

### 6.3 제공자 전환

1. 사용자에게 확인을 받는다.
2. 새 제공자로 6.2를 수행한다. 보통은 빈 루트이므로 전부 올린다. iPad가 먼저 옮겼다면 합친다.
3. 성공하면 옛 루트에 있는 자기 `devices/<id>.json`에 `moved_to`를 쓴다(P6).
4. 옛 루트 감시를 멈추고 바인딩을 바꾼다. 옛 파일은 지우지 않는다.

- 2단계가 실패하면 옛 제공자를 계속 쓴다. 두 루트를 동시에 활성으로 두지 않는다.
- 다른 기기가 `moved_to`를 보면 "MacBook Air가 Google Drive로 옮겼어요. 이 기기도 옮길까요?"를 띄운다.

### 6.4 프로필 ↔ 동기화 묶음

- 프로필 하나는 루트 하나에만 묶인다.
- 한 기기 안에서 루트 하나에는 프로필 하나만 묶인다. 다른 프로필이 이미 쓰는 루트를 고르면 "이 저장소는 '<프로필>' 프로필과 연결돼 있어요"라고 안내하고 거부한다.
- 바인딩은 프로필 userData의 `sync/state.json`에 둔다.
  - 필드: `{provider, root, account, bundle_id, device_id, machine, next_seq, cursor}`
- 동기화는 활성 프로필만 한다. 프로필을 바꾸면(재실행) 다른 프로필의 동기화는 멈춘다.
- "백업 후 새 프로필"로 만든 프로필은 바인딩 없이 시작한다.
- `bandal.json`의 `bundle_id`(P6)가 바인딩 값과 다르면 다른 묶음으로 보고 6.2를 다시 한다. 예를 들어 사용자가 클라우드 폴더를 비웠거나 Mac의 Apple ID가 바뀐 경우다.
- 계정 바인딩(`profile-access.json`의 `boundUserID`)은 없앤다(7장). 이제 프로필은 동기화 묶음 단위일 뿐이다.

---

## 7. 로그인 선택화 (게이트 제거)

### 7.1 바꾸는 곳

| 위치 | 변경 |
|---|---|
| `src/renderer/src/main.tsx:25` | `<AccountAccessGate>` 래퍼를 없앤다. `AccountAccessGate.tsx`는 지우거나, 로그인 카드 부분만 재사용한다 |
| 첫 화면(온보딩) | 첫 카드 "반달 계정"에 버튼 셋을 둔다: [로그인 없이 시작](기본), [Apple로 계속], [Google로 계속] |
| `registerHandlers.ts:322,351` | `beforeLogin` 허용 목록과 `login-required` 검사를 없앤다. **`profileBusy()`(백업 중) 검사는 남긴다** |
| `registerHandlers.ts:658` | 미디어 프로토콜의 `localAccessAllowed()` 검사를 없앤다 |
| `accountRuntime.ts` `getClient()` | 영수증과 `boundUserID` 조건을 빼고 세션만 확인한다 |
| `localAccessStore.ts`, `auth:confirmProfile` | 더 이상 읽거나 쓰지 않는다. `profile-access.json` 파일은 지우지 않는다. 옛 버전으로 되돌렸을 때 그대로 동작하게 하기 위해서다 |
| 서버 기능 | `account.getClient()`가 null이면 해당 화면 안에서 로그인 카드를 보여 준다. 대상은 커뮤니티, 스터디 마켓, 플러그인 제출, 피드백, 닉네임, 계정 삭제다 |

### 7.2 로그인이 필요한 기능

- **서버를 실제로 쓰는 기능**은 로그인 없이 동작할 수 없다. 지금처럼 해당 화면에서 로그인을 요청한다.
  - 커뮤니티(`community/client.ts`)
  - 스터디 마켓
  - 플러그인 마켓 제출
  - 피드백(`feedbackService.ts:60`)
  - 닉네임
  - 계정 삭제
- **AI는 반달 서버를 거치지 않는다.**
  - 사용자 기기의 Claude Code, Codex, Gemini CLI와 그 계정으로 동작한다.
  - 웹사이트 개인정보처리방침에도 "반달 서버가 이 요청을 중계하지 않습니다"라고 적혀 있다.
  - 그래서 "로그인이 필요한 기능은 AI뿐"을 지키려면 **정책 게이트를 새로 만들어야 한다.** 채팅 패널과 오브를 처음 쓸 때 로그인을 확인하는 방식이 된다.
  - 기술적으로 필요한 게이트는 아니므로 결정이 필요하다(D4).
- 어느 쪽으로 정해도 `requireLogin(feature)` 도우미 하나로 처리한다.

### 7.3 기존 사용자 이전

| 사용자 | 업데이트 후 |
|---|---|
| 로그인 상태 | `session.enc`가 유지되므로 그대로 로그인돼 있다 |
| 로그아웃해서 잠긴 상태 | 바로 자기 자료로 열린다 |
| 다른 계정에 묶인 프로필(`profile-mismatch`) | 제한 없이 열린다. 자료는 원래 로컬에 있다 |
| 옛 버전으로 되돌림 | 영수증 파일이 남아 있으므로 옛 동작 그대로다 |

### 7.4 리프레시 토큰 만료

- 게이트가 없어지면 로컬 자료는 인증 상태와 무관해진다.
- auth-js의 동작은 다음과 같다.
  - 재시도할 수 없는 갱신 오류: 세션을 지우고 SIGNED_OUT을 보낸다. 화면에는 "로그아웃됨"으로 표시한다.
  - 오프라인처럼 재시도할 수 있는 오류: 세션을 유지한다.
- 이 동작은 PR1의 E2E에서 확인한다.
  1. 무효한 리프레시 토큰을 넣은 `session.enc`를 준비한다.
  2. 네트워크를 끊고 앱을 실행한다.
  3. 과목 목록과 PDF가 열리는지 본다.
  4. 서버 기능(D4에 따라 AI도)이 "다시 로그인"을 보여 주는지 본다.

### 7.5 Kakao 제거

- 버튼을 없앤다. 대상은 로그인 카드, `AccountPanel.tsx:134`(로그인), `AccountPanel.tsx:269`(로그인 수단 연결)다.
- `AuthProvider` 타입에서 `'kakao'`를 뺀다. 이미 Kakao identity가 연결된 세션은 계속 읽을 수 있게 둔다.
- 서버의 Kakao 프로바이더는 이미 꺼져 있다(1단계 실측). 그래서 Kakao 단독 계정은 지금도 로그인할 수 없다. 대상 사용자 수는 사람이 조회한다(13장).
- 웹사이트 "내 구독" 로그인 안내에도 Kakao가 있다(8.6).

### 7.6 Apple 웹 플로우

- **확인한 것**(F2): authorize 요청은 `app.bandal.web`과 `https://auth.bandal.io/auth/v1/callback`으로 나가고, Apple은 이 조합에 정상 화면을 낸다.
- **남은 것**
  1. 사람이 mac과 Windows에서 실제로 로그인해 콜백부터 세션 생성까지 확인한다. 시크릿 JWT가 틀렸다면 Supabase 콜백에서 실패한다.
  2. 시크릿 JWT의 만료일(최대 6개월)을 기록하고 갱신 알림을 건다.
  3. iPad 네이티브 로그인은 `aud=app.bandal.ipad`다. Supabase Apple 프로바이더의 Client IDs에 `app.bandal.web`과 `app.bandal.ipad`가 둘 다 있는지 확인한다.

### 7.7 (선택) 인증 도메인 통일

- 콜백은 이미 `auth.bandal.io`를 쓴다. 앱이 authorize를 `…supabase.co`에서 시작하는 것은 화면에 보이는 주소만 다를 뿐이다.
- 통일한다면 별도 PR로 하고, 세 가지를 함께 한다.
  - `MAIN_VITE_SUPABASE_URL=https://auth.bandal.io`
  - **`auth.storageKey: 'sb-ukacrkcwiqafwpppshxb-auth-token'`으로 고정**(F11)
  - iPad의 `iss` 검사에 미치는 영향 확인(iPad 조사 §5)
- 우선순위는 낮다.

---

## 8. ipadSync·Paddle 숨김

### 8.1 플래그

- 런타임 환경 변수 `BANDAL_LEGACY_IPAD_SYNC=1`일 때만 기존 동작을 켠다. 기본은 꺼짐이고, 코드는 그대로 둔다.
- 빌드 상수가 아니라 환경 변수로 하는 이유가 있다. 배포본에서도 지원 대응이나 자료 회수를 위해 켤 수 있어야 하기 때문이다.

### 8.2 범위

| 대상 | 플래그가 꺼졌을 때(기본) |
|---|---|
| `IPadCompanion` 런타임(브리지 프로세스, 15초 폴링, 포커스 시 동기화) | 시작하지 않는다 |
| 메뉴 "iPad"(`ipadSync/runtime.ts:31-42`) | "계정으로 자동 동기화", "지금 동기화", "구독 관리…", "동기화 상태"를 뺀다. `.bandalpack` 내보내기·가져오기는 D3에 따른다(권장: 유지) |
| `BillingSyncPanel`(`AccountPanel.tsx:138,266`) | 렌더링하지 않는다 |
| `AccountPanel.tsx:279`의 구독 문구 | "계정 삭제는 Apple·Paddle 구독 해지가 아닙니다"는 플래그와 상관없이 남긴다. 기존 구독자가 있기 때문이다 |
| IPC `runtime:sync*`, `billing:*` | `{ok:false, reason:'disabled'}`를 돌려준다 |
| `ipadCompanion.pauseAndDrain()`(`registerHandlers.ts:3786,3843,3874`: 백업·계정 삭제·로그아웃) | 런타임이 없으면 바로 돌아온다 |
| `changesSyncContent`(`registerHandlers.ts:323`) | 새 엔진은 쓰지 않는다(outbox 폴링). 철거할 때 함께 정리한다 |
| 패키징(PyInstaller 브리지, `beforePack` 검사) | PR1에서는 그대로 둔다. 크기와 빌드 시간을 줄이는 일은 철거 때 한다 |

### 8.3 영향

- 계정 동기화를 쓰던 사용자는 새 동기화가 나올 때까지 기기 간 반영이 멈춘다. 각 기기의 로컬 자료는 그대로다.
- 서버 사본은 삭제일까지 지원 요청으로 회수할 수 있다(8.4, 8.5).

### 8.4 서버 즉시 중단 (이미 설치된 옛 버전 대비)

앱을 업데이트해도 옛 버전은 계속 업로드한다. 그래서 승인 후 사람이 SQL 편집기에서 아래를 실행한다.

```sql
-- 쓰기만 막는다. 읽기(bandal_pull, 자산 다운로드)는 삭제일까지 남겨 자료 회수 경로로 쓴다.
revoke execute on function public.bandal_push(/* 실제 인자 목록 */) from public, anon, authenticated;
drop policy if exists bandal_assets_create on storage.objects;
```

- 실행 전에 `bandal_push`의 정확한 시그니처를 확인해 인자 목록에 넣는다.
- Supabase에서는 함수가 기본적으로 `public`에도 실행 권한이 열려 있다. 그래서 세 역할 모두에서 뺀다.
- 실행하면 옛 데스크톱과 옛 iPad 빌드에 동기화 오류가 표시된다. 공지와 같은 날 실행한다.

### 8.5 서버 자료 삭제 — 공지 문구와 절차

**공지**(앱 안 공지 모달, 웹사이트, 결제자 이메일)

> **반달 동기화 방식이 바뀝니다**
>
> 반달은 이제 여러분의 PDF, 필기, 노트를 반달 서버에 보관하지 않습니다. 컴퓨터와 iPad 사이의 동기화는 여러분이 고른 iCloud나 Google Drive에서 무료로 이뤄집니다. 로그인하지 않아도 됩니다.
>
> - **{D0}부터** '계정으로 자동 동기화'를 멈춥니다. 각 기기에 있는 자료는 그대로 남습니다.
> - **{D0+30}에** 반달 서버에 보관된 동기화 사본을 삭제합니다. 백업에서도 {보존 기간} 안에 완전히 지워집니다.
> - 그전에 한 기기에만 있는 자료가 없는지 확인해 주세요. 서버 사본이 필요하면 {D0+30} 전에 hi@bandal.io로 요청해 주세요.
> - Bandal Sync 구독은 {D0}에 해지되며, 남은 기간은 {환불 방식(D1)}으로 환불합니다.
>
> 궁금한 점은 hi@bandal.io로 보내 주세요.

**절차**

| 단계 | 시점 | 작업 | 누가 |
|---|---|---|---|
| 1 | D0 | PR1 릴리스, 8.4 쓰기 차단, 공지 게시, 웹 문구 교체(8.6), Paddle 신규 판매 중지 | 개발 + 사람 |
| 2 | D0 | 활성 구독 해지와 환불(D1) | 사람(Paddle) |
| 3 | D0~D0+30 | 자료 회수 요청 대응 | 사람 |
| 4 | D0+30 | 스토리지 삭제. **SQL로 `storage.objects` 행을 지우면 실제 파일은 남는다.** 그래서 Storage API(`remove`, service role, 1,000개씩)나 대시보드의 "Empty bucket"으로 `bandal-assets`를 비운다 | 사람 |
| 5 | D0+30 | DB 삭제. `bandal_records`, `bandal_changes`, `bandal_operations`, `bandal_sync_usage`, `bandal_sync_beta_access`를 비운다 | 사람 |
| 6 | D0+30 | 확인. 행 수 0, 버킷 객체 수 0. 결과를 `docs/`에 기록한다 | 사람 + 개발 |
| 7 | 계속 | Paddle 결제·환불 기록은 지우지 않는다. 전자상거래법상 보존해야 한다 | — |

5단계의 테이블 목록은 `supabase/migrations/20261013005000_personal_sync.sql`과 `20261015020000_sync_paid_access.sql`을 기준으로 했다. 함수와 버킷 정책 정리는 별도의 철거 단계로 미룬다.

### 8.6 웹사이트(bandal-web) 수정안

웹 레포 수정은 이번 범위가 아니어서 문구만 제안한다. 반영은 D0 일정에 맞춘다.

**동기화·요금 안내**

| 위치 | 지금 | 수정안 |
|---|---|---|
| `src/content/sync.ts` | `status: 'available'`, 4,900원·49,000원·5 GiB | `status: 'free'`를 새로 두고 가격·용량은 null로 바꾼다. 운영자 정보는 다른 곳에서 쓰면 유지한다 |
| `src/components/SyncPage.astro` | 선택형 유료 구독, "같은 반달 계정", "5 GiB", "서버로 전송" | 제목: "PC와 iPad를 무료로 이어 쓰세요". 리드: "필기와 PDF, 노트를 여러분의 iCloud나 Google Drive로 동기화합니다. 반달 서버에는 자료가 올라가지 않고, 로그인도 필요 없습니다." 요약 3칸: "무료 · 용량은 내 클라우드 기준 · iCloud / Google Drive". 상세에는 세 가지를 쓴다: 반달 서버에 보관하지 않음, Drive는 `drive.file` 권한(반달이 만든 파일에만 접근), Windows의 iCloud는 실험적. 구독·요금제 링크는 없앤다 |
| `src/components/SyncIntro.astro:11-15` | "선택형 유료 구독 · iPad 앱은 개발 배포 단계" | "무료 · iCloud 또는 Google Drive" |
| `src/components/PricingPage.astro` | Sync 월간·연간 요금제와 Paddle 안내 | "반달은 무료입니다" 한 장으로 줄인다. 데스크톱 무료, 동기화 무료, AI 요금은 각 제공자 기준. iPad 구독이 생기면 App Store 안내만 둔다 |
| `src/components/Nav.astro:17-18,50` | "Sync", "요금제", "내 구독" | "요금제"는 없애거나 "무료"로 바꾼다. "내 구독"은 기존 구독자 정리가 끝날 때까지 "구독 정리 안내"로 바꾸고, 그 뒤 없앤다 |
| `src/components/Footer.astro:14` | Bandal Sync, 요금제 | "동기화" 하나로 합친다 |
| `src/components/DownloadButton.astro:31` | "Sync는 선택형 유료 구독입니다" | "동기화도 무료입니다(iCloud·Google Drive)" |
| `src/components/DocsPage.astro:165` | "선택형 유료 서비스로 준비 중… 서버로 전송" | "동기화는 무료이며 사용자가 고른 iCloud나 Google Drive를 저장소로 씁니다. 반달 서버로 자료를 보내지 않습니다." |
| `src/i18n/ko.ts:42`(FAQ) | 유료 구독 설명 | 위와 같은 취지로 바꾼다 |

**결제와 테스트**

| 위치 | 지금 | 수정안 |
|---|---|---|
| `src/pages/billing/*`, `src/scripts/paddle-*-checkout.ts` | Paddle 결제 | 결제 진입을 막는다. `/billing`은 "Bandal Sync 구독 종료와 환불 안내"로 바꾼다. 스크립트는 기존 구독 정리 뒤에 없앤다 |
| `tests/paddle-*.spec.ts`, `tests/checkout.spec.ts` | 결제 테스트 | 결제 진입 차단에 맞게 고친다 |

**정책 페이지(`src/components/PolicyPage.astro`)**

| 페이지 | 지금 | 수정안 |
|---|---|---|
| 이용약관 | "2. 무료 앱과 선택 구독"(57-59), 결제(63-65), 동기화 지연·용량(70-71), 만료(76) | 동기화를 "사용자 클라우드 저장소를 쓰는 무료 기능"으로 다시 쓴다. Sync 구독 조항은 "종료된 서비스" 부칙으로 옮기고 종료일, 환불, 자료 삭제일을 적는다 |
| 개인정보처리방침 | "5. 반달 Sync에서 처리하는 정보"(130-138), Supabase 수탁 항목의 "동기화 자료 저장"(150), Paddle(152), 보관(159), 내 구독 로그인(94, Kakao 포함) | 5장을 다음 내용으로 바꾼다: "동기화 자료는 사용자의 iCloud나 Google Drive에만 저장한다. Google Drive를 연결하면 `drive.file` 범위의 접근 토큰을 기기 안에 암호화해 저장한다. 반달 서버는 이 자료와 토큰을 받지 않는다." 서버 사본 삭제 일정은 부칙으로 둔다. Google API 서비스 사용자 데이터 정책(Limited Use) 준수 문구도 넣는다(동의 화면 심사에 필요하다) |
| 환불 정책(172-195) | Sync 구독 환불 | 종료 공지와 환불 방식(D1)으로 바꾼다. 기존 구독자 정리가 끝나면 페이지를 정리한다 |

---

## 9. 데이터 루트 이동

### 9.1 대상과 목표

| 대상 | 지금 | 이동 후 |
|---|---|---|
| 기본 프로필 mac | `~/Documents/Bandal` | `~/Library/Application Support/bandal/Courses` |
| 기본 프로필 Windows | `%USERPROFILE%\Documents\Bandal`(OneDrive 폴더 리디렉션이 켜져 있으면 OneDrive 안) | `%APPDATA%\bandal\Courses` |
| 프로필 | `profiles/<id>/Courses`(`profileManager.ts:91`, 이미 userData 안) | 그대로 둔다. 단, `settings.json`의 dataRoot가 옛 기본값이면 같은 절차로 옮긴다 |
| 새 설치 기본값 | `settingsStore.ts:41` | `<userData>/Courses` |

- **옮기는 조건**: `settings.dataRoot`가 옛 기본값과 같고 그 폴더가 실제로 있을 때만 옮긴다.
- **건드리지 않는 것**: 사용자가 직접 고른 위치, 연결형 과목, `BANDAL_DATA_ROOT`(E2E용).
- **이동이 아니라 복사로 하는 이유**
  - `~/Documents`는 iCloud 영역이다. 밖으로 `rename`하면 iCloud는 이를 삭제로 처리하고, 같은 Apple ID의 다른 Mac에서도 폴더가 사라진다.
  - dataless 파일은 rename해도 데이터가 따라오지 않는다.

### 9.2 절차

앱 시작 때 실행하고, DB를 열기 전과 연 뒤의 두 부분으로 나뉜다. 진행 상태는 저널 파일 `<userData>/data-root-migration.json`에 `{state, from, to, startedAt}`로 기록한다.

1. **planned**
   - 옮길 파일 목록과 전체 크기를 계산한다.
   - 여유 공간을 확인한다(`fs.statfs`, 전체 크기 × 1.1 이상).
   - "자료 폴더를 옮기고 있어요" 진행 화면을 띄운다. [나중에]를 누르면 옛 위치를 계속 쓴다.
2. **materializing**
   - dataless 파일을 2.4와 같은 방법으로 내려받는다.
   - 오프라인이거나 실패하면 중단하고 옛 위치를 계속 쓴다. 다음 실행 때 다시 묻는다.
3. **copying**
   - `<to>.partial`로 복사한다. `fs.cp(recursive, preserveTimestamps)`에 `COPYFILE_FICLONE`을 주면 APFS 클론이 되어 추가 공간이 거의 들지 않는다.
   - 파일마다 크기와 SHA-256을 대조한다.
4. **db-rewrite**
   - 한 트랜잭션 안에서 아래 값의 앞부분을 옛 경로에서 새 경로로 바꾼다.
     - `courses.folder_path`(관리형만)
     - `material_tree_snapshots.folder`
     - `material_added_baselines.folder`
     - `agent_sessions.launch_config_json`의 cwd
   - 대화 기록(`message_blocks.payload_json`)은 기록이므로 고치지 않는다.
5. **switch**
   - `<to>.partial`을 `<to>`로 rename한다(원자적).
   - `settings.json`의 dataRoot를 바꾼다(원자적 쓰기).
   - 트랜잭션을 커밋한다.
6. **done**
   - 옛 폴더에는 아무것도 하지 않는다.
   - 설정 › 저장 위치에 "이전 폴더 정리" 버튼을 둔다. 확인을 받은 뒤 휴지통으로 옮긴다(D8).

### 9.3 실패와 롤백

| 실패 지점 | 처리 |
|---|---|
| 1~3단계 | `<to>.partial`을 지운다. DB와 설정은 그대로다 |
| 4단계 | 트랜잭션을 롤백하고 `<to>.partial`을 지운다 |
| 5단계 rename 뒤, 커밋 전 | rename을 되돌린다 |
| 5단계 설정 쓰기 뒤 앱 종료 | 다음 시작 때 저널이 `switch`면 새 위치를 검사한다(과목 폴더가 있는지, DB 경로가 맞는지). 맞으면 `done`, 아니면 설정과 DB를 옛 값으로 되돌린다 |

옛 폴더는 어느 단계에서도 바꾸지 않는다. 그래서 언제든 이전 상태로 돌아갈 수 있다.

### 9.4 영향

- **AI 세션 재개**
  - Claude Code는 cwd별로 세션을 저장한다(F8). 폴더가 바뀌면 옛 대화의 `--resume`이 실패할 수 있다.
  - 대응: `~/.claude/projects/<옛 cwd 인코딩>`을 새 cwd 인코딩 이름으로 **복사**한다. 최선 노력이고 원본은 그대로 둔다.
  - 복사에 실패하면 새 세션으로 시작한다. 화면의 대화 기록은 그대로 남는다.
  - 인코딩 규칙(영숫자가 아닌 문자를 `-`로 바꿈)은 Claude Code 내부 규칙이라 바뀌면 깨질 수 있다(D9).
  - Codex와 Gemini가 cwd에 의존하는지는 PR1에서 확인한다.
- **같은 Apple ID의 다른 Mac**
  - 지금은 iCloud "데스크톱 및 문서"를 통해 과목 폴더가 우연히 공유되고 있었을 수 있다.
  - 이동 뒤에는 Mac마다 따로 복사하므로 그 공유가 끝난다. 새 동기화가 그 역할을 대신한다.
- **Finder**
  - 자료가 숨김 폴더(`~/Library`) 아래로 간다. "Finder에서 보기"는 그대로 동작한다.
  - 이동 완료 안내에 새 위치를 보여 준다.
- **Windows `%APPDATA%`는 로밍 프로필이다.**
  - 학교 PC 같은 도메인 환경에서는 로그온과 로그오프가 느려질 수 있다.
  - 브리프 결정대로 하되 위험은 적어 둔다(D11). Electron userData(`bandal.db`)도 이미 같은 곳에 있다.

---

## 10. PR 분할과 순서

| PR | 내용 | 검사 | 선행 |
|---|---|---|---|
| **PR1**(브리프 지정) | ① ipadSync 업로드 중단 + Paddle UI 숨김(8장) ② Kakao 제거(7.5) ③ 로그인 선택화(7.1–7.4, D4 반영) ④ 데이터 루트 이동(9장). 커밋은 이 넷으로 나눈다 | 단위: 이동 저널과 롤백(임시 폴더, 실패 주입), 경로 재작성. E2E: 로그인 없이 시작 → 과목 열기, 만료 토큰 + 오프라인 → 자료 열림, 설정에 결제 패널 없음, iPad 메뉴에 동기화 항목 없음. 수동: dataless 파일이 섞인 실제 `~/Documents/Bandal` 이동(mac), Windows 이동 | X2 |
| PR2 | Windows NSIS에서 `bandal://` 등록. `nsis.include: build/installer.nsh`를 추가한다. `customInstall`이 `HKCU\Software\Classes\bandal`(`URL Protocol`, `shell\open\command` = `"$INSTDIR\Bandal.exe" "%1"`)을 쓰고, `customUnInstall`이 지운다. `electron-builder.yml:78-80`의 틀린 주석도 고친다 | 깨끗한 Windows에서: 설치 → 앱을 실행하지 않은 채 `start bandal://auth/callback` → 앱이 열리는지 | PR1과 병렬 |
| PR3 (a) | ID 안정화와 상태 테이블(v39), 트리거, device_id·seq·지문 | 단위: 해시 재매칭, 외부 삭제 2회 규칙, apply 중 트리거 미기록, M24·M25 | PR1 |
| PR4 (b) | 머지 엔진, 형식 파서, sync-fixtures 적합성 테스트, V5 렌더 픽스처 테스트 | M01–M23, R01 | PR3, P1·P4 합의 |
| PR5 (c) | 엔진 + iCloudProvider(mac) + 최소 설정 UI(켜기·끄기·상태) + 초기 연결(합치기) + 재구성 차단. "동기화(베타)"로 공개한다. **먼저 실험 X1–X3를 통과해야 한다** | 통합: 임시 폴더를 루트로 쓰는 가짜 iCloud. 수동: 실제 iPad 왕복 | PR4, iPad 컨테이너 |
| PR6 (d) | DriveProvider + `google/oauth.ts` 공유 + 데스크톱 시크릿(Gmail 수정 포함) | 통합: Drive API 목업. 수동: 실제 계정, 기기 2대 | PR5, X6 |
| PR7 (f) | 설정 화면 완성: 덮어쓰기, 가져오기(새 프로필), 제공자 전환, 기기 목록, 충돌 사본 알림 | E2E: 초기 연결 3가지 | PR6 |
| PR8 (h) | Windows: iCloud(실험적)와 Drive 검증, 수동 체크리스트 | 수동 | PR7 |
| PR9(선택) | 인증 도메인 통일 + storageKey 고정 | 단위: 기존 세션 유지 | PR1 |

- 각 PR은 AGENTS.md 기준을 따른다. 해당 검사만 돌린 뒤 커밋하고 배포한다.
- 포맷이 바뀌는 PR(PR4)은 iPad 쪽 PR과 같은 날 머지한다.

---

## 11. sync-fixtures 초안

함께 낸 `sync-fixtures/`의 자세한 구성은 `sync-fixtures/README.md`에 있다.

- **예제 4개**
  - 01: 과목·PDF·노트·필기 각 1개 이상. 필기는 펜, 형광펜, 이미지, 글상자
  - 02: 같은 id를 양쪽에서 수정
  - 03: 삭제 후 수정 / 수정 후 삭제
  - 04: 노트를 양쪽에서 수정
- **렌더 예제 1개**: V5 지름 계수
- 각 `expected.json`의 `requires`에는 그 예제가 전제하는 변경 제안 번호(P1, P3, P4)를 적었다.
- 데스크톱 팀이 원본을 관리하고 iPad 팀이 검증한다. 공유 방식은 D12에서 정한다.
- 이번 초안에 없는 경우는 PR4에서 단위 테스트로 다룬다.
  - format 초과(M19)
  - 세 기기 충돌(M12)
  - 노트 이미지(P5)
  - 끝에 쪽을 덧붙인 PDF(P9)

---

## 12. Drive 쿼터 대응

1단계 계산(보고서 10장)을 스펙 v2의 간격(활성 30초, 유휴 5분)으로 다시 했다.

| 가정 | 하루 호출 수 |
|---|---|
| 데스크톱: 하루 8시간 켜 둠. 그중 활성 3시간, 유휴 5시간, 포커스 40회 | 360 + 60 + 40 = 460 |
| iPad: 앞에 띄워 쓰는 시간 2시간, 앞으로 전환 30회 | 240 + 30 = 270 |
| 사용자 1명(기기 2대) | 약 730 |

| `changes.list` 단가 | 사용자 1명의 하루 units | 하루 400M units 임계에 닿는 일일 사용자 수 |
|---|---|---|
| 100(목록류로 가정) | 73,000 | 약 5,500명 |
| 5(읽기류로 가정) | 3,650 | 약 110,000명 |

- **분당 프로젝트 한도 1,000,000 units**: 단가가 100이면 활성 기기 1대가 분당 2회 × 100 = 200 units를 쓴다. 따라서 동시에 활성인 기기가 약 5,000대면 한도에 닿는다. 유휴 기기는 분당 0.2회다.
- **대응**
  1. PR6 내부 시험 때 Cloud Console(API 및 서비스 › Google Drive API › 할당량·측정항목)에서 `changes.list`의 실제 단가를 확인한다.
  2. 일일 사용량과 분당 최대치가 각각 50%에 이르면 알림이 오도록 한다(Cloud Monitoring 알림 정책 + 결제 예산 알림).
  3. **증설 신청 시점**은 어느 한쪽이 1주 동안 50%를 넘을 때다. 단가 100 기준으로 일일 사용자 약 2,700명, 또는 동시 활성 기기 약 2,500대다. 심사에 며칠에서 몇 주가 걸리므로 미리 신청한다.
  4. **클라이언트 보호**: 429나 403 rate limit을 받으면 백오프한다. 30분 안에 3번 반복되면 활성 간격을 60초로 늘린다. 창이 가려지거나 화면이 잠기면 유휴로 본다.
  5. Windows에서는 Drive를 권장하므로, Windows 사용자 비율이 높을수록 쿼터가 빨리 찬다. 이 비율은 웹사이트 다운로드 통계로 추정한다.

---

## 13. 사람이 콘솔에서 할 일

### Supabase (`ukacrkcwiqafwpppshxb`, 커스텀 도메인 `auth.bandal.io`)

1. Authentication › Providers › Kakao: 꺼진 상태를 유지한다(이미 꺼져 있다).
2. Authentication › Providers › Apple
   - Enabled
   - Client IDs = `app.bandal.web,app.bandal.ipad`
   - Secret Key = SIWA 키(.p8)로 서명한 JWT. 만료일을 기록하고 6개월이 되기 전에 갱신한다.
3. Authentication › URL Configuration › Redirect URLs에 `bandal://auth/callback`이 있는지 확인한다.
4. Kakao 단독 계정 수를 조회한다.

   ```sql
   select count(*) from auth.users u
   where exists (select 1 from auth.identities i where i.user_id=u.id and i.provider='kakao')
     and not exists (select 1 from auth.identities i where i.user_id=u.id and i.provider<>'kakao');
   ```

5. D0에 8.4의 SQL을 실행한다. D0+30에 8.5의 4–6단계를 실행한다.

### Apple Developer (팀 VUZ7Z98BW3)

6. Identifiers › Services IDs › `app.bandal.web` › Sign in with Apple
   - Primary App ID는 현재 값을 유지한다(확인만 한다).
   - Domains = `auth.bandal.io`
   - Return URLs = `https://auth.bandal.io/auth/v1/callback`

   2026-10-30 authorize 확인에서 Apple이 이 조합을 받아들였다.
7. Identifiers › iCloud Containers에서 `iCloud.app.bandal`을 만든다. 한 번 만들면 지우거나 이름을 바꿀 수 없다.
8. App ID `app.bandal.ipad`에서 iCloud(iCloud Documents)를 켜고 위 컨테이너를 고른다. 그다음 개발용·App Store용 프로파일을 다시 받는다.
9. iPad Info.plist의 `NSUbiquitousContainers`(iPad 팀 담당): `iCloud.app.bandal` 아래에 다음을 둔다.
   - `NSUbiquitousContainerIsDocumentScopePublic=YES`
   - `NSUbiquitousContainerName=반달`
   - `NSUbiquitousContainerSupportedFolderLevels=Any`
10. 데스크톱은 v1에서 할 일이 없다. 엔타이틀먼트와 프로파일을 쓰지 않는다.

### Google Cloud (프로젝트 번호 565020221852, Gmail 클라이언트와 같은 프로젝트)

11. API 및 서비스 › 라이브러리에서 Google Drive API를 사용 설정한다.
12. Google 인증 플랫폼 › 데이터 액세스에 `https://www.googleapis.com/auth/drive.file`을 추가한다(민감하지 않은 스코프).
13. 브랜딩을 채운다.
    - 앱 이름 "반달"
    - 지원 이메일 `hi@bandal.io`
    - 홈페이지 `https://bandal.io`
    - 개인정보처리방침 `https://bandal.io/privacy`
    - 서비스 약관 `https://bandal.io/terms`
    - 승인된 도메인 `bandal.io`
14. 대상에서 게시 상태를 "프로덕션"으로 둔다. Gmail(`gmail.modify`, 제한 스코프)의 검증 상태도 확인한다. 같은 프로젝트를 계속 쓸지는 D10이다.
15. 클라이언트 › 데스크톱 클라이언트 `565020221852-c8mv…`에서 **보안 비밀을 추가**한다.
    - 값을 GitHub Actions secret `MAIN_VITE_GOOGLE_DESKTOP_CLIENT_SECRET`과 로컬 `.env.development.local`, `.env.production.local`에 넣는다.
    - 기존 시크릿 값을 모른다면 새로 추가하는 것이 정상 경로다.
16. iOS 클라이언트(번들 `app.bandal.ipad`)를 **같은 프로젝트**에 만든다(iPad 팀 담당). drive.file 접근은 앱(프로젝트) 단위로 알려져 있다. 다만 같은 프로젝트의 다른 클라이언트가 만든 파일이 보이는지는 X6에서 실측한다.
17. 12장의 알림 정책과 결제 예산 알림을 만든다.

### GitHub (seojune662/bandal)

18. Secrets에 `MAIN_VITE_GOOGLE_DESKTOP_CLIENT_SECRET`을 추가한다. `release.yml`에서 이 값을 쓰는 부분은 PR6에서 넣는다.

### Paddle

19. Sync 가격과 상품을 보관 처리해 신규 판매를 멈춘다. 활성 구독은 D1에 따라 해지·환불한다. 웹훅은 마지막 구독이 정리될 때까지 유지한다.

### Kakao Developers

20. 꼭 할 일은 없다. 원하면 카카오 로그인을 비활성화하고 Supabase 콜백 Redirect URI를 지운다.

### Vercel / bandal-web

21. 8.6의 문구를 D0에 배포한다.

---

## 14. 공통 스펙 v2 변경 제안

스펙은 고치지 않았다. 합의되면 두 저장소에 같은 날 반영한다.

| # | 제안 | 이유 | 구분 |
|---|---|---|---|
| **P1** | `doc.upsert`(md)에 `md_base`를 더한다. 값은 편집을 시작한 버전의 md_hash이고, 새 문서면 null이다. 충돌 사본 id는 `uuidv5(9b1f6a2e-3c4d-4e5f-8a6b-7c8d9e0f1a2b, "<document_id>:<진 쪽 md_hash>")`로 정한다 | 아래 반례 | **필수** |
| P2 | t가 같으면 device_id가 사전순으로 **큰** 쪽이 이긴다. 로컬 t는 `max(now, remote_max+1, last_t+1)`. 이벤트 작성자는 log 폴더의 device_id다 | v2 문구 "사전순"에는 방향이 없다. 같은 기기의 시계가 뒤로 가는 경우도 다뤄야 한다 | 명확화 |
| P3 | `rel_path` = 과목 안 폴더 경로(루트는 `""`), `name` = 확장자를 포함한 파일 이름. 둘 다 NFC로 정규화한다. `.`으로 시작하는 경로 구간은 동기화하지 않는다 | 이름 변경과 폴더 이동이 동시에 일어나도 둘 다 남는다. 한글 NFC/NFD 중복을 막는다 | 명확화 |
| P4 | 필기 개체 = `pdf_drawings` 행(3.4 표). 색은 토큰 7종이고 hex 표를 고정한다. width는 표시 페이지 폭에 대한 비율이고 V5 지름은 `width × 계수`다. 그리기 순서는 `(created, id)`다. `clip`은 뺀다. 경계 밖 좌표는 받아 두고 그릴 때 자른다 | v2가 "설계안에서 합의"로 남겨 둔 부분이다 | **필수** |
| P5 | `doc.upsert`(md)에 `md_assets: {"<본문 속 상대 경로>": "<sha256>.<ext>"}`를 더한다. 첨부 파일은 `assets/`에 둔다 | 노트 이미지가 다른 기기에서 깨지지 않게 한다. iPad 조사 §3.1과 같은 방향이다 | v1에 노트 이미지를 넣으면 필요 |
| P6 | `devices/<id>.json`에 `format`(그 기기가 쓰는 형식)과 `moved_to?`를 더한다. `bandal.json`에 `bundle_id`(처음 만든 기기가 정한 UUID)를 더한다 | `bandal.json`은 처음 만든 기기만 쓸 수 있어 format을 올릴 기기가 없다. 제공자 전환을 다른 기기에 알리고, 루트가 초기화된 것도 알아챌 수 있다 | 권장 |
| P7 | seq는 기기당 카운터 하나를 모든 파일 종류가 함께 쓴다. 세션은 앱 실행 1회다. 노트 파일은 세션당 1개다 | 해석이 갈리면 파일 이름이 겹친다 | 명확화 |
| P8 | 초기 연결에서 같은 문서 = 같은 과목(같은 id, 또는 사용자가 이름으로 합친 과목) + 같은 sha256. 과목이 다르면 같은 PDF도 다른 문서다. 삭제된 과목에 살아 있는 문서가 있으면 과목을 표시한다(파생 규칙) | "sha가 같으면 같은 문서" 규칙이 과목 경계를 넘으면 안 된다. 삭제와 추가가 동시에 일어나도 손실 0을 지킨다 | 명확화 |
| P9 | 끝에 페이지를 덧붙이는 것만 허용한다. 같은 document_id에 새 `pdf_sha256`을 쓰고 기존 쪽 번호는 바꾸지 않는다. 그 밖의 재구성은 계속 막는다 | 손글씨 노트에 쪽을 더하는 기능이 막히지 않게 한다. 양쪽이 동시에 덧붙이면 덜 덧붙인 쪽이 지고, 진 쪽의 새 쪽에 쓴 필기는 숨겨진다(삭제되지 않고 보존) | 선택(D6) |
| P10 | iCloud 임시 파일은 루트 밖에 쓰고 rename으로 넣는다. Drive 루트는 `appProperties.bandalRoot`로 표시하고, 여러 개면 가장 이른 것을 쓴다. Drive에서 같은 이름의 파일이 여럿이면 늦게 바뀐 쪽을 쓴다 | 두 구현의 동작을 맞춘다 | 명확화 |
| P11 | (측정 후) 필기 JSON 숫자 정밀도를 좌표 소수 6자리, p 4자리로 줄인다 | iPad 조사 §10.1에 따르면 용량의 대부분이 숫자다. 1e-6 × 842pt ≈ 0.0008pt라 눈에 보이지 않는다 | 보류 |

### P1이 필요한 이유(반례)

1. 노트 X의 공통 버전이 H0이다.
2. 데스크톱이 오프라인에서 H0을 H_A(t=100)로 고친다. 자기 iCloud 폴더에 쓰는 일은 오프라인에서도 된다.
3. iPad도 오프라인에서 H0을 H_B(t=105)로 고친다.
4. 둘이 다시 연결되고, 데스크톱이 H_B(t=105)를 받는다.
5. 이때 데스크톱이 아는 것은 두 가지뿐이다.
   - 자기 로컬 내용이 자기가 마지막으로 쓴 H_A와 같다. 즉 아직 내보내지 않은 편집은 없다.
   - H_B가 이긴다.
6. H_B가 H_A를 보고 고친 것인지는 알 수 없다. 그래서 데스크톱은 충돌 사본을 만들지 않고 H_A를 덮는다.
7. iPad는 자기가 이겼으므로 아무것도 하지 않는다.
8. 결국 H_A는 클라우드 파일에만 남고 화면에서는 사라진다.

`md_base`가 있으면 H_B의 base가 H0이므로 "H_A를 보지 못한 편집"이라고 어느 기기든 같은 방식으로 판정할 수 있다. 충돌 사본은 id가 결정적이라 중복되지 않는다. 04 픽스처가 바로 이 경우다.

---

## 15. 결정 필요

| # | 결정할 것 | 선택지 | 권장 |
|---|---|---|---|
| D1 | Paddle 기존 구독자 | (a) D0에 해지하고 남은 기간을 일할 환불 (b) 다음 갱신만 멈추고 요청이 오면 환불 | (a). 서비스가 D0에 멈추기 때문이다 |
| D2 | 서버 사본 삭제일 | D0+30 / D0+90 | D0+30. 읽기는 그때까지 열어 둔다 |
| D3 | `.bandalpack` 수동 내보내기·가져오기 | 유지 / 숨김 | 유지. 서버가 필요 없고, 새 동기화가 나오기 전까지 기기 간 이동 수단은 이것뿐이다 |
| D4 | "로그인이 필요한 기능은 AI뿐"의 뜻 | (a) AI를 처음 쓸 때 반달 로그인을 요구하는 게이트를 새로 만든다 (b) 서버를 쓰는 기능만 로그인을 요구한다 | 의도 확인이 필요하다. AI는 반달 서버를 쓰지 않는다. 커뮤니티 등은 어느 쪽을 골라도 로그인이 필요하다 |
| D5 | 연결형 과목(외부 폴더) 동기화 | v1에서 제외 / 포함 | 제외. 다른 기기의 자료가 사용자 폴더에 써지는 일을 피한다 |
| D6 | 손글씨 노트 끝에 쪽 덧붙이기(P9) | 허용 / 모두 차단 | 허용. iPad 팀 합의가 필요하다 |
| D7 | 필기 색 표현 | 토큰 7종 / `#rrggbbaa` | 토큰. 두 앱의 저장 형식 그대로이고 손실이 없다 |
| D8 | 옛 `~/Documents/Bandal` | 남겨 두고 설정에 정리 버튼 / 이동 뒤 자동으로 휴지통 | 남겨 둔다. iCloud 용량은 계속 쓴다는 점을 안내한다 |
| D9 | Claude 세션 재개를 위한 폴더 복사 | 최선 노력으로 복사 / 하지 않음 | 복사(원본 유지). Claude Code 내부 규칙에 기대는 위험이 있다 |
| D10 | Google Cloud 프로젝트 | Gmail과 같은 565020221852 / 동기화 전용 새 프로젝트 | 같은 프로젝트. 브리프가 이 클라이언트를 지정했다. 다만 Gmail 제한 스코프가 미검증 상태여서 동의 화면에 영향을 주는지는 13장 14번에서 확인한다 |
| D11 | Windows 데이터 루트 | `%APPDATA%`(브리프) / `%LOCALAPPDATA%` | 브리프대로 한다. 로밍 위험만 안내한다 |
| D12 | sync-fixtures 공유 | 데스크톱 레포가 원본, iPad 레포는 복사(해시 검사) / 별도 레포를 서브모듈로 | 앞쪽. 더 단순하다 |
| D13 | 14장 제안 P1–P11 | iPad 팀과 합의 | P1과 P4는 PR4 전에 합의해야 한다 |

---

## 16. 3단계 실험 체크리스트 (검토 항목 대응)

실험 코드는 `exp/sync-*` 브랜치에서만 쓰고 PR로 올리지 않는다.

| # | 질문 | 방법 | 언제 |
|---|---|---|---|
| X1 | 엔타이틀먼트 없이 mac이 쓴 파일이 iPad까지 가는가 | 컨테이너를 만든 뒤(13장 7–9) iPad 테스트 빌드로 폴더를 만든다. 데스크톱 실험 빌드가 `log/…json`을 rename으로 넣고, iPad에서 NSMetadataQuery로 받는 시간을 잰다. 반대 방향도 잰다 | PR5 전 |
| X2 | 패키징된 Electron에서 dataless 파일을 읽을 수 있는가 | 서명한 실험 빌드에서 dataless PDF를 `fs.readFile`로 읽는다. 온라인과 오프라인 각각의 결과와 시간을 잰다. 실패하면 Swift 헬퍼를 시험한다 | PR1 전(이동 절차에도 필요) |
| X3 | iCloud 폴더 감시가 안정적인가 | 하루 동안 iPad에서 파일 200개를 바꾼다. `fs.watch` 이벤트 수와 5분 재스캔 결과를 비교해 누락률을 구한다 | PR5 |
| X4 | Windows + iCloud for Windows | 같은 측정을 Windows에서 한다. 플레이스홀더를 내려받는 데 걸리는 시간과 오프라인 오류의 형태도 본다 | PR8 |
| X5 | Drive `changes.list` 단가와 하루 사용량 | 기기 2대로 하루를 쓰고 Cloud Console에서 확인한다 | PR6 |
| X6 | drive.file이 다른 클라이언트에서도 보이는가 | 데스크톱 클라이언트가 만든 폴더를 같은 프로젝트의 iOS 클라이언트가 `files.list`로 볼 수 있는지 확인한다 | PR6 전 |
| X7 | 오프라인 두 기기 동시 편집 후 획 손실 0 | M16 단위 테스트 + 실제 기기로 수동 1회 | PR4, PR5 |
| X8 | 깨끗한 Windows: 설치 → Google·Apple 로그인 → 딥링크 복귀 | PR2 설치본으로 수동 확인 | PR2 |
| X9 | 리프레시 토큰 만료 상태에서 로컬 자료가 열리는가 | 7.4의 E2E | PR1 |

---

## 부록 A. 이번에 실행한 확인

모두 읽기 전용이다. 외부로 나간 요청은 1–3번뿐이다.

```sh
# 1. Supabase Apple authorize (로그인은 진행하지 않음)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  "https://auth.bandal.io/auth/v1/authorize?provider=apple&redirect_to=bandal%3A%2F%2Fauth%2Fcallback"
# 2. Apple authorize 화면: 실제 client_id와 가짜 client_id의 응답 비교 (invalid_client 유무)
# 3. Google 토큰 엔드포인트: 가짜 code로 PKCE 교환 → "client_secret is missing."
curl -s -X POST https://oauth2.googleapis.com/token -d "client_id=$MAIN_VITE_GMAIL_CLIENT_ID" \
  -d code=4/bogus -d "code_verifier=…" -d redirect_uri=http://127.0.0.1:53682/oauth/callback -d grant_type=authorization_code
# 4. brctl / fileproviderctl 명령 목록
brctl --help; fileproviderctl
# 5. dataless 감지와 읽기
stat -f 'size=%z blocks=%b flags=%Sf' <파일>; cat <dataless 파일>   # → Resource deadlock avoided
# 6. DB 속 절대 경로 (읽기 전용 연결)
sqlite3 -readonly "file:$HOME/Library/Application Support/bandal/bandal.db?mode=ro" \
  "select count(*) from courses where folder_path like '%/Documents/Bandal%'"
# 7. V5 지름 계수: 임시 스크립트가 src/shared/inkV5.ts를 esbuild로 묶어 계산 (레포에 넣지 않음)
```

## 참고 자료

- Google — Choose Google Drive API scopes(`drive.file`은 민감하지 않은 스코프): https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google — Drive API usage limits: https://developers.google.com/workspace/drive/api/guides/limits
- Apple Developer Forums — 프로비저닝 프로파일과 Developer ID 엔타이틀먼트: https://developer.apple.com/forums/thread/126823 , https://developer.apple.com/forums/thread/44140
- FileProvider dataless 파일의 EDEADLK 보고(샌드박스 프로세스): https://claudeissues.com/issue/40783-bug-file-read-failure-on-macos-fileprovider-backed-paths-google-drive-icloud-etc , https://claudeissues.com/issue/85578-bug-cowork-device-bridge-icloud-evicted-files-list-normally-but-are-unreadable-w
- iPad 1단계 조사: `bandal-iPad:docs/ipad-sync-phase1-survey-2026-10-29.md`

---

## 17. 승인 후 반영 (2026-10-30)

이 장의 내용이 앞 장과 다르면 이 장을 따른다. 스펙 본문은 `sync-fixtures/SPEC.md`(v2.1)다.

### 17.1 사용자 결정

| 항목 | 결정 |
|---|---|
| P1 `md_base`, D6 끝에 페이지 덧붙이기 | 수용. 스펙 v2.1에 넣었다 |
| 필기 숫자 | 좌표(`points[].x/y`, `box`)는 소수 5자리, 압력은 3자리. fixtures에 반영했다 |
| D4 AI | 양쪽 모두 BYOK로 두고 반달 AI 서버는 없다. 로그인 관문도 없다. 로그인은 선택이고 지금은 아무것도 막지 않는다. 서버 기능은 해당 화면에서 로그인을 요청한다 |
| 데이터 루트 | `~/Library/Application Support/bandal/Courses` 승인 |
| D1 Paddle 구독자 | 0명이면 공지만 한다. 있으면 D0에 해지하고 남은 기간을 일할 환불한다 |
| D2 | 공지 30일 뒤에 서버 사본을 삭제한다 |
| D5 | 연결 폴더 과목은 v1에서 제외한다 |
| 그 밖의 D3, D7–D12 | 설계안 승인에 따라 권장안대로 한다 |

### 17.2 iPad 2단계 설계안과 대조해 바꾼 것

iPad 설계안은 `bandal-iPad:docs/ipad-sync-phase2-design-2026-10-30.md`다.

| 항목 | 이전(이 문서) | 바꾼 것 | 이유 |
|---|---|---|---|
| 이미지 개체 | relPath 힌트 + sha256 | relPath 없이 `sha256` + `ext`(iPad 안) | 기기 로컬 경로를 밖으로 내보내지 않는다 |
| 묘비 | 내용을 포함한 del | 최소형 `{id, page, t, del}`도 허용(iPad 안) | 행이 사라진 경우에도 묘비를 낼 수 있다 |
| 노트 첨부 | P5 `md_assets` 대응표 | 본문 링크를 `../../assets/<sha>.<ext>`로 정규화하고, md_hash는 정규화한 바이트로 계산(iPad 안) | sha 이름이라 이름 충돌이 없고, 루트만으로 노트가 완결된다 |
| 경로 충돌 | 받는 쪽이 `(2)`를 붙인다 | document_id가 가장 작은 문서만 이름을 유지하고, 나머지는 `(<id 앞 4자>)`를 붙이는 doc.upsert를 낸다(iPad 안 + 보강) | 어느 기기가 처리해도 결과가 같고, 이름이 바뀌는 문서는 하나뿐이다 |
| 원격 입력 검증 | 없음 | 경로 탈출 거부, 크기 상한, 해시 대조, 보류(iPad §2.7) | 공유 폴더나 손상 파일로 데이터 루트를 덮는 일을 막는다 |
| format | 2보다 크면 중단 | 2가 아니면 중단 | v1 포맷은 배포된 적이 없다 |
| fixture 형식 | `tree/`, 배열, `deleted` | `root/`, id 맵, `alive`, `conflict_copies`·`ignored`·`errors`(iPad §10) | 순서와 상관없이 비교할 수 있고, 무시 규칙도 검증할 수 있다 |

### 17.3 데스크톱 안을 유지한 것

| 항목 | iPad 안 | 유지한 이유 |
|---|---|---|
| doc `name`/`rel_path` | name은 확장자를 뺀 이름, rel_path는 파일 이름까지 포함한 경로 | 폴더와 이름을 나눠야 이름 변경과 이동이 동시에 일어나도 둘 다 남는다. iPad 안에서는 rel_path LWW 때문에 한쪽이 사라진다 |
| expected의 필기 표현 | 정규 JSON의 해시 | 개체 전체를 JSON 값으로 비교한다. 두 언어의 숫자 표기 규칙을 맞추지 않아도 된다 |
| 렌더 예제 | iPad 구현이 만든 외곽선 | 공식이 같으므로 지름 계수로 충분하다. iPad가 외곽선 예제를 더하면 받는다. 값이 다르면 그때 기준을 정한다 |

### 17.4 아직 열린 것

- **P6**(기기별 format, `moved_to`, `bandal.json`의 `bundle_id`)
  - iPad 안에는 없다. 다만 iPad도 "루트 정체성"을 따로 저장하므로(`cloud_sync_state.root_identity`) 방향은 같다.
  - PR5 전에 다시 제안한다.
- **점의 t·기울기 반올림**: iPad는 소수 1자리를 제안했다. 이번 결정 범위 밖이라 원래 값을 유지한다.
- **범위 밖 좌표**: iPad는 받을 때 [0,1]로 클램프해 저장한다. 받는 쪽 저장 방식이라 스펙에서는 허용으로 적었다.

## 18. 3단계 PR3 구현에서 바뀐 것 (2026-10-31)

PR3는 상태 테이블(v39), device_id·seq·기기 지문, 문서 ID 고정, apply, 그리고 provider 대신 파일 목록을 받는 입력부(`pull.ts`)다. 내보내기(outbox → 파일), t 발급(M23), 루프와 provider는 PR5에서 한다.

### 18.1 상태 테이블

머지(`merge.ts`)는 루트 전체를 매번 다시 계산하는 순수 함수다. 그래서 2.6 표의 "레지스터"는 "마지막으로 동기화한 값(base)"이 됐다.

| 테이블 | PR3 |
|---|---|
| `sync_runtime(enabled, applying)` | 2.6 그대로 |
| `sync_outbox(seq, kind, id)` | `(kind, id)`는 유일하지 않다. 트리거의 INSERT가 사용자 쓰기를 실패시키는 일이 없게 한다. `seq`는 AUTOINCREMENT라 줄지 않으므로 "max(seq)가 1.5초 그대로"로 idle을 잰다. kind는 `course`, `ink`, `docs`(과목 id: 그 과목을 다시 대조) |
| `sync_meta(kind, entity_id, field, value_json, t, device_id)` | 과목·문서 필드의 base와 그 값의 (t, device_id). 파생 값(충돌 사본)은 t가 NULL |
| `sync_docs` | `local_hash`(마지막 스캔이 본 바이트), `synced_hash`(마지막 동기화 때 바이트), `local_size`·`local_mtime`, `missing_since`. `local_hash`가 NULL이면 원격 문서를 쓰는 중이다. 행이 없는데 base가 살아 있으면 "여기서 지웠고 내보내기 전"이다 |
| `sync_ink(id, doc_id, page, t, device_id, updated_at)` | 마지막으로 동기화한 버전, 그때 행의 `updated_at`, 그리고 행이 사라져도 묘비를 만들 수 있게 문서와 쪽 |
| `sync_alias` | 초기 연결(PR5)에서 만든다 |
| `sync_note_versions`, `sync_files` | 만들지 않는다. 버전 그래프는 원격 파일에서 매번 다시 계산하고, 읽은 파일은 메모리에 버전별로 둔다 |

### 18.2 apply 규칙

- **로컬 변경 보호**: 로컬 값이 base와 다르면 아직 내보내지 않은 로컬 변경으로 보고 건드리지 않는다. 내보낼 때 t가 본 적 있는 원격 t보다 크므로 결국 이긴다.
  - 노트·PDF는 파일 바이트를 `synced_hash`와 비교한다. 원격 바이트를 읽는 동안 사용자가 고쳤을 수 있어서, 쓰기 직전에 다시 확인하고 마지막 rename 직전에 크기·mtime을 한 번 더 본다.
  - 필기는 행의 `updated_at`을 base와 비교하고, 쓰는 트랜잭션 안에서 다시 확인한다.
  - 위치는 폴더와 이름을 따로 비교하고 따로 base에 기록한다. 경로 충돌로 붙은 `(abcd)` 이름도 "손대지 않은 이름"으로 본다.
- **되돌림 방지**: 원격 값의 (t, device_id)가 base보다 작으면 루트에서 파일이 빠진 것으로 보고 무시한다.
- **불완전한 루트**: 읽지 못한 스펙 파일이나 iCloud 자리표시자가 하나라도 있으면 아무것도 적용하지 않는다. PDF·자산은 이름이 곧 해시라 목록만으로 있다고 보고, 필요할 때 읽어서 해시를 확인한다.
- **과목 삭제**: 문서와 필기를 적용한 뒤에 처리한다. 원격에 살아 있는 문서가 있거나(P8), 여기서 고쳐서 남겨 둔 파일이 있으면 과목을 남긴다. 지울 때는 소프트 삭제만 하고 폴더는 남긴다(앱 안에서 지울 때와 같다). 2026-11-01에 이 방식으로 확정했다. 지우거나 보관한 과목은 결과의 `removed`로 알려, 엔진이 녹음·감시·세션을 정리하게 한다.
- **문서 삭제**: 파일을 OS 휴지통으로 옮긴다. 여기서 옮기거나 고친 파일은 남긴다. 여기서 지운 문서는 다음 pull이 되살리지 않는다.
- **충돌 사본**: 사본이 더 이상 계산되지 않아도 지우지 않는다. 버전이 head에서 빠진 것과 루트에서 파일이 빠진 것을 구별할 수 없고, 내용은 루트 이력에 남아 있다.
- **이동·이름 변경**: materials 저널(`move`/`rename`)로 옮겨 필기·링크·PDF 바인딩이 따라오게 한다. 이름이 이미 쓰이고 있으면 다음 pass에서 다시 시도한다.
- **다른 과목으로 이동**: 새 과목에 바이트를 먼저 쓴다. 그다음 한 트랜잭션에서 행·필기·하이라이트·PDF 별칭을 옮기고, 마지막에 옛 파일을 휴지통으로 보낸다.
- **로컬 이름**: 앱이 받는 이름으로 바꾼다(materials `requireBasename`).
  - `\ : * ? " < > |`는 전각 문자로 바꾼다.
  - 앞의 점·공백과 끝의 점·공백은 뺀다. 스캔이 점으로 시작하는 항목을 숨기고, Windows가 끝의 점을 버리기 때문이다.
  - 120자로 자른다.
  - Windows 장치 이름(COM¹ 등 포함) 앞에는 `_`를 붙인다.
  - 파일 이름에 형식의 확장자가 없으면 붙인다. 그래야 스캔이 그 문서를 추적한다.
  - 내보내기는 같은 `localPath(base)`로 비교해야 이 차이를 이름 변경으로 착각하지 않는다.
- **노트 첨부**: `../../assets/<sha>.<ext>`를 과목의 `assets/<sha>.<ext>`로 바꿔 쓴다. 편집기가 붙여 넣은 이미지를 두는 곳이다. 필기 이미지도 같은 폴더에 받는다. 그래서 `synced_hash`는 이렇게 바꾼 바이트의 해시이고, base의 `hash`는 스펙의 `md_hash`다.
- **이름 충돌**: 같은 경로에 다른 파일이 있으면 `이름 (2).확장자`로 쓴다(3.3). 디스크가 대소문자를 무시하므로 경로는 NFC로 바꾼 뒤 대문자로 바꿔 비교한다.
- **문서 ID 고정과 삭제 판정**: v39에서 한 번에 고정하지 않고, 파일을 처음 대조할 때 고정한다. PDF는 바인딩의 `material_id`, 없으면 `materials_index.id`를 쓴다.
  - 끝까지 돈 스캔 두 번이 1분 이상 간격으로 놓쳐야 삭제로 본다.
  - 스캔이 개수·깊이 상한에서 멈췄으면 놓친 것으로 보지 않는다.

### 18.3 내보내기가 지킬 것

- t는 `MergedState` 전체의 최대 t(적용하지 않은 레지스터 포함)보다 커야 한다.
- 트리거는 연결형 과목과 학습 공간에도 기록한다. 내보낼 때 거른다.
- 원격 이동이나 이미지 경로 갱신(`rewritePdfDrawingImageSources`)도 필기 `updated_at`을 바꾼다. 내보낼 때는 내용을 비교해서 같으면 base만 맞춘다.
- PDF 바이트가 바뀐 문서는 `pdf_sha256`과 함께 `pdf_prev_sha256`을 쓴다(v2.3). 앱의 재구성(`pdf_restructure_log`)이 base의 sha256에서 지금 sha256으로 바꿨고, 그 recipe가 기존 쪽을 그대로 둔 채 끝에만 쪽을 더한 경우에만 base의 sha256을 쓴다. 그 밖에는 null이다.

### 18.4 열린 것

- 원격 PDF 바이트 변경(D6)과 경로 충돌 키는 19장에서 정했다.
- **대소문자만 다른 원격 이름 변경**: 대소문자를 무시하는 디스크에서는 적용하지 않는다.

## 19. 스펙 v2.3 반영 (2026-11-01)

| 항목 | 사용자 결정 | 구현 |
|---|---|---|
| 경로 충돌 키 | 코드 포인트마다 `lower(upper(c))`. iPad가 Node·Swift의 전 코드 포인트 결과가 같음을 확인했다. 규칙의 근거는 macOS와 Windows다(iPadOS의 APFS는 대소문자를 구분한다) | `merge.ts`의 `foldCase`. 예제 06의 끝 시그마도 이제 겹친다. 디스크(APFS)와 스펙이 같은 이름을 같게 보므로, apply 테스트에서 "(2)" 예외를 지웠다 |
| 원격 PDF 바이트 변경(D6) | `doc.upsert`에 `pdf_prev_sha256`을 더한다. 받는 쪽은 바인딩 sha256이 그 값과 같으면 새 sha256으로 다시 묶고 필기를 유지한다. 다르면 기존 보호를 따른다 | `format.ts`가 이벤트 안에서 짝을 맞춘다. 없으면 null로 읽고, `pdf_sha256` 없이 오면 버린다. `apply.ts`의 `rebind`는 파일을 바꾸는 트랜잭션 안에서 `pdf_document_bindings.bound_sha`를 바꾼다(`evidence = 'sync'`). 다른 과목으로 옮기면서 바뀐 경우도 같다. 예제 12를 더했다 |
| 원격 과목 삭제 | 소프트 삭제만 하고 폴더는 남긴다 | PR3 구현 그대로다. 3.2의 문장을 고쳤다 |

- 파일 rename과 재바인딩은 메인 프로세스의 한 동기 구간에서 일어난다. 그래서 그 사이에 뷰어의 바인딩 확인이 끼지 않는다.
- **변경 제안(v2.4 후보)**: 덧붙이기를 두 번 이상 놓친 기기는 보호로 간다. 예를 들어 데스크톱이 꺼진 동안 iPad에서 쪽을 세 번 더하면, 데스크톱은 H0에 묶여 있는데 이긴 이벤트의 `pdf_prev_sha256`은 H2다. 손글씨 노트에서는 흔한 경우다.
  - 받는 쪽이 루트의 모든 `doc.upsert`에서 `pdf_prev_sha256 → pdf_sha256` 연결을 모아, 묶인 sha256에서 이긴 sha256까지 이어지면 다시 묶자는 제안이다.
  - 쓰는 쪽과 머지 결과는 바뀌지 않는다. 파일 교체(null)가 끼면 연결이 끊겨 지금처럼 보호로 간다.

