# 반달 데스크톱 로그인·동기화 — 1단계 현황 조사

- 조사일: 2026-10-29
- 기준: `main` c21ad28 (package.json 0.92.6), 설치본 `/Applications/Bandal.app` 0.92.5
- 대조: iPad 리포 `~/dev/bandal-iPad`(1.1.0)를 읽기 전용으로 비교
- 범위: 코드는 수정하지 않았다. 이번에 한 확인은 다음 네 가지뿐이다(재현 명령은 부록 A).
  - 코드 읽기
  - 설치본 번들 grep
  - 로컬 DB 개수 조회(읽기 전용)
  - Supabase authorize 엔드포인트 응답 확인(로그인을 끝까지 진행하지 않음)

## 0. 요약

| # | 발견 | 영향 |
|---|---|---|
| 1 | 로그인이 필수다. 앱 전체를 `AccountAccessGate`가 감싸고, main IPC도 로그인 전 채널을 `login-required`로 거부한다. | 원칙 1 위반. 첫 실행, 새 기기, 로그아웃 뒤에는 온라인 로그인 전까지 로컬 자료도 열 수 없다. |
| 2 | Supabase를 거치는 iPad 동기화(`ipadSync`, Python 브리지)와 Paddle 구독 게이트가 이미 출시돼 있다. | "Supabase에 자료 업로드 금지", "구독은 iPad 전용", "로그인과 동기화 분리" 원칙과 충돌한다. 철거와 이전 경로를 결정해야 한다. |
| 3 | 로그인 버튼 3개는 같은 코드와 같은 URL(`https://ukacrkcwiqafwpppshxb.supabase.co/auth/v1/authorize?provider=…`)을 쓴다. Google만 동작한다(콜백 `https://auth.bandal.io/auth/v1/callback`). Kakao는 Supabase에서 꺼져 있고, Apple은 OAuth 시크릿이 없어 둘 다 400을 받는다. | 브리프의 `auth.bandal.app`은 실제로는 `auth.bandal.io`다. 도메인 차이는 앱 코드가 아니라 서버 설정에서 생긴다. |
| 4 | 안정 UUID 현황: 과목과 획은 있음. PDF 문서는 처음 열 때 생성된다. md 노트는 캐시 ID뿐이다. 페이지, device_id, seq는 없다. | 3단계 (a) 마이그레이션의 범위다. |
| 5 | 데스크톱은 이미 PDF 위 필기를 편집한다(SVG 오버레이, SQLite). 좌표는 표시 CropBox 기준 0..1, 색은 이름 7종이다. 기울기와 샘플 시각은 기록하지 않는다. 도형과 텍스트박스가 있고, 획 이동과 색 변경도 된다. | 변환 레이어가 필수다. P1 "필기는 표시만"과 기존 편집 기능의 관계를 정해야 한다. |
| 6 | 스펙 좌표는 MediaBox 기준인데, 데스크톱과 iPad의 기존 구현은 둘 다 CropBox 기준이다. | 스펙 변경 제안 1순위(9장) |
| 7 | 페이지 재배치·삭제·회전·삽입 기능이 PDF를 같은 경로에 다시 쓴다(이전 바이트는 `PDFOriginals/`에 보존). | 스펙의 "불변 pdf + page_ids" 모델로 옮기는 매핑 규칙이 필요하다. |
| 8 | 텍스트 노트는 과목 폴더 안의 `.md` 파일이고, 저장할 때 파일 전체를 쓴다. iPad도 `.md`를 쓴다. | 공통 포맷으로 Markdown 스냅샷을 제안한다(2장). |
| 9 | 기본 자료 위치 `~/Documents/Bandal`이 이 Mac에서는 이미 iCloud Drive(데스크톱 및 문서 폴더) 안에 있다. 파일 142개 중 83개가 dataless다. | 해시 계산과 폴더 감시를 설계할 때 플레이스홀더가 일상이라는 전제가 필요하다. |
| 10 | 빌드 쪽 공백: Windows NSIS 설치기는 `bandal://`을 등록하지 않는다(실행 시 런타임 등록만 한다). mac에는 프로비저닝 프로파일과 iCloud 엔타이틀먼트가 없다. iPad 앱도 아직 iCloud 엔타이틀먼트가 없다. | iCloud 실기기 테스트는 iPad 쪽 엔타이틀먼트가 먼저 들어가야 할 수 있다. |

---

## 1. 로컬 저장 구조

### 1.1 위치

| 무엇 | 위치 | 근거 |
|---|---|---|
| userData(프로필 루트) | mac `~/Library/Application Support/bandal`, Windows `%APPDATA%\bandal`. 새 프로필은 `<base>/profiles/<uuid>/` | `src/main/index.ts:72-74`, package.json `name`이 app.name을 결정 |
| SQLite | `<userData>/bandal.db` (WAL, better-sqlite3) | `src/main/db/schema.sql`, `src/main/db/migrations.ts`(v1~v38). 일부 테이블은 기능 모듈이 실행 중에 `CREATE TABLE IF NOT EXISTS`로 만든다 |
| 과목 폴더 | 관리형 `<dataRoot>/<slug>` 또는 사용자가 연결한 임의 폴더(`courses.source='linked'`). dataRoot 기본값은 `~/Documents/Bandal` | `src/main/settingsStore.ts:38-41`, `src/main/features/courses/coursesRepo.ts:255-273,320-364` |
| 로그인 세션 | `<userData>/auth/session.enc` (safeStorage 암호화) | `src/main/features/account/sessionStore.ts:171-173` |
| 로컬 접근 영수증 | `<userData>/profile-access.json` (평문, 토큰 없음) | `src/main/features/account/localAccessStore.ts:32` |
| PDF 이전 바이트 보존 | `<userData>/PDFOriginals/<sha256>.pdf` | `src/main/features/pdf/pdfOriginals.ts`, `registerHandlers.ts:663` |
| 노트 쓰기 복구 저널 | `<userData>/NoteRecovery` | `src/main/features/pdf/pdfNotes.ts:51` |
| 기존 iPad 동기화 | `<userData>/ipad-companion/`(preferences.json, status.json, 교환 폴더), iPad에서 받은 과목은 `<userData>/iPad Courses` | `src/main/features/ipadSync/runtime.ts:103,329-330` |

원칙은 "디스크가 진실, DB는 색인"이다. 다만 필기, 강조, 문서 ID 같은 메타데이터는 DB에만 있다.

### 1.2 엔터티별 실체

| 개념 | 데스크톱 실체 | 저장 형태 | ID |
|---|---|---|---|
| 과목 | `courses` 행 + 폴더 | name, slug, color, folder_path, source, archived, sort_order, group_id, workspace_kind(`course`/`study-space`), created/updated/deleted_at(ISO, soft delete) | `randomUUID()` (`coursesRepo.ts:268,320`). 영구 |
| 과목 그룹 | `course_groups` + `courses.group_id` | SQLite (마이그레이션 v17) | UUID |
| 문서: PDF | 과목 폴더 안의 `.pdf` 파일. 하위 폴더를 허용한다 | 디스크 원본, `materials_index`(재구축 가능한 캐시), `pdf_document_bindings(material_id, bound_sha, evidence, legacy_unverified)`, `pdf_document_aliases(course_id, rel_path → material_id)` | `material_id` UUID는 PDF를 처음 확인할 때 생기고, 앱 안에서 이름을 바꿔도 `repoint`로 유지된다 (`src/main/features/pdf/pdfDocumentBinding.ts:148-213`) |
| 문서: 필기 노트 | `노트/` 폴더의 pdf-lib 생성 PDF. 종이(blank/lines/grid/dots), 방향, 표면(light/dark)은 PDF Keywords에 저장한다 | 디스크 (`pdfNotes.ts:185-203`, `notePaper.ts:31-43`) | 위 PDF와 같다 |
| 문서: 텍스트 노트 | `.md` 파일 | 디스크 (2장) | `materials_index.id`뿐. 캐시라서 영구 ID가 아니다(1.3) |
| 페이지 | 별도 엔터티가 없다. PDF 페이지 번호(1-based)만 있다 | `pdf_drawings.page`, `annotations.page` | 없음 |
| 필기·도형 | `pdf_drawings` (kind: ink / highlighter / rect / ellipse / arrow / line / textbox / clip / image) | `data_json`, `style_json`, soft delete (`migrations.ts:181-199`, `src/shared/types/drawing.ts`) | `randomUUID()`. 영구 |
| 텍스트 강조 | `annotations` (색 4종, rects_json, 텍스트 앵커, 코멘트) | SQLite | UUID |
| PDF 페이지 노트 | 쪽별 구획을 가진 `.md` + `material_links`(kind `pdf-page-note`) | 디스크 + SQLite (`src/shared/pdfPageNote.ts`) | 링크 UUID |
| 옛 화이트보드 | `whiteboards`, `whiteboard_local_shapes` | v0.85.0에서 PDF 노트로 이전됐다(결정적 UUID, `legacyNoteMigration.ts:15-18`) | |
| 기타 자료 | 이미지, 영상, 녹음, 오피스, hwp 등의 파일 | 디스크 | 캐시 ID |

개발 머신 실측(읽기 전용 개수 조회): 과목 8, PDF 45(바인딩 30), md 62, 이미지 110, 기타 111, 영상 1. 살아 있는 `pdf_drawings`는 11개(image 3, rect 3, textbox 5)이고, 삭제 표시된 것이 63개다.

### 1.3 공통 스펙 식별자와의 대응

| 스펙 ID | 데스크톱 후보 | 상태 | 업그레이드 시 필요한 일 |
|---|---|---|---|
| device_id | 없음 | ✗ | 첫 실행에 생성해 보존. 프로필을 유지한다면 프로필마다 하나 |
| course_id | `courses.id` | ✓ | 없음 |
| document_id (PDF) | `pdf_document_bindings.material_id` | △ 지연 생성(실측 45개 중 30개만 있음) | 전체 PDF를 1회 바인딩. 이때 SHA-256 계산이 필요하다 |
| document_id (md) | `materials_index.id` | △ | 영구 ID 테이블이 새로 필요하다. 이유는 아래 |
| page_id | 없음 | ✗ | (문서, PDF 페이지) → UUID 테이블. 재구성 때 매핑을 유지해야 한다(3.5) |
| stroke id | `pdf_drawings.id` | ✓ | 없음 |
| seq | 없음 | ✗ | 기기별 카운터 |

`materials_index`를 영구 ID로 쓸 수 없는 이유는 다음과 같다.
- 재스캔 upsert는 같은 경로라면 id를 유지한다(`src/main/features/materials/materialsRepo.ts:371-383`).
- 하지만 사라진 경로의 행은 지운다(`:391`).
- 그래서 Finder나 탐색기에서 이름을 바꾸거나 옮기면 새 UUID가 생긴다.
- PDF는 바인딩 테이블이 이 공백을 메우지만, md 노트에는 그런 장치가 없다.

### 1.4 "프로필" (`백업 후 새 프로필`)

- 구현은 `src/main/features/account/profileManager.ts`에 있다. 진입점은 로그인 게이트(`AccountAccessGate.tsx:60-63`)와 설정 › 계정(`src/renderer/src/features/settings/AccountPanel.tsx:275`)이다.
- 절차는 세 단계다.
  1. 사용자가 고른 위치에 전체 백업 폴더를 만든다(`*.bandalbackup`).
     - `bandal.db`: SQLite backup API로 복사
     - `profile/`: userData 사본. 캐시, `auth`, 세션 스토리지 등은 제외(`profileManager.ts:24`)
     - `courses/<course_id>/`: 모든 과목 폴더 사본
     - `manifest.json`: SHA-256 목록
     - 백업 중에 원본이 바뀌면 실패 처리한다.
  2. `<base>/profiles/<uuid>/`를 만든다. 안에는 `isolated-profile.json`과 `settings.json`(dataRoot = `profiles/<uuid>/Courses`)이 들어간다.
  3. `<base>/active-profile.json` 포인터를 쓴 뒤 재시작한다.
- 시작할 때 `resolveActiveProfile()`이 `userData` 경로를 바꾼다. 이 작업은 single-instance lock보다 먼저 일어난다(`src/main/index.ts:72-74,103`).
- 분리 단위는 userData 전체(DB, 세션, 영수증, 브라우저 데이터, 설정)와 dataRoot다.
  - 이전 프로필 자료는 디스크에 그대로 남는다.
  - 되돌아가는 UI는 없다. 포인터 파일을 직접 고치는 방법뿐이다.
- 존재 이유는 계정 바인딩이다.
  - 영수증이 한 계정에 묶이므로 다른 계정을 쓰려면 새 프로필이 필요하다(`localAccessStore.ts:67`, `AccountAccessGate.tsx:32,44`).
  - 원칙 1이 적용되면 이 이유는 사라진다. 그러면 프로필은 "독립된 자료 묶음" 기능만 남는다(11장 결정 2).
- 참고: 백업 제외 목록에 `Cookies`, `saved-logins.enc`, `Local State`가 없어서 이 파일들이 백업 사본에 포함된다. 의도한 것인지 확인이 필요하다.

---

## 2. 텍스트(타이핑) 노트

### 2.1 현재 형식과 편집 단위

- 형식은 과목 폴더 안의 일반 `.md` 파일이다(`src/main/features/notes/notesRepo.ts:1-6`, `src/shared/types/note.ts`).
- 에디터는 Milkdown 7.22(ProseMirror)이고 commonmark, gfm, prism, math(remark-math, KaTeX)를 쓴다.
- 이미지는 과목의 `assets/`에 파일로 저장하고 본문에는 `assets/...` 상대경로를 남긴다(`src/renderer/src/features/notes/noteImagePlugin.ts:15,193-194`).
- 편집 단위는 문서 전체다.
  - 렌더러가 800ms 유휴 후 `notes:write`를 호출한다(`src/renderer/src/features/notes/NoteTab.tsx:121`).
  - main은 tmp→rename 원자 쓰기를 하고, `expectedMtime`이 다르면 ConflictError를 낸다(낙관적 동시성).
- 제목 규칙: 첫 H1이 곧 파일명이다. 이름 바꾸기는 파일명과 H1을 한 트랜잭션으로 고친다(`notesRepo.ts:31-37`).
- 변형 형식으로 PDF 페이지 노트가 있다. Markdown에 `<!-- bandal:pdf-page-note {...} -->` 매니페스트와 쪽 경계 주석이 들어간다(`src/shared/pdfPageNote.ts`).
- iPad도 노트를 `.md` 파일로 만든다(`bandal-iPad/App/Native/Storage/NativeLibraryRepository.swift:484`).

### 2.2 포맷 제안 (스펙 추가안, iPad 팀 합의 필요)

스펙의 `type:"note"`는 손필기 노트북으로 보인다. 그래서 텍스트 노트는 **새 문서 타입 `"text"`**로 분리할 것을 제안한다.

```
root/text/<doc_id>/<device_id>-<seq 8자리>.json.gz
{"rev":"<uuid>","base":"<uuid>|null","t":ms,"format":"gfm-1","text":"<markdown 전체>","assets":["<sha256>",...]}
```

- 한 파일에는 그 세션의 최신 리비전 하나를 담는다. 자기 파일은 세션 동안 덮어쓰고, 스펙의 기존 규칙을 그대로 따른다.
- 머지 규칙(v1):
  - 다른 리비전의 `base`로 참조되지 않는 리비전을 head라고 한다.
  - head가 하나면 그것이 문서다.
  - head가 둘 이상이면(오프라인 동시 편집) `t`가 큰 쪽을 본문으로 삼는다.
  - 나머지 head는 "(충돌 사본 · 기기명)" 노트로 만든다.
  - 자동 삭제는 하지 않으므로 텍스트 손실은 0이다.
- v1.1 여지: v1에는 compaction이 없어서 `base` 리비전이 클라우드에 남는다. 이를 이용해 줄 단위 3-way 병합(diff3)을 추가할 수 있다.
- 방언은 CommonMark + GFM(표, 체크리스트, 취소선) + `$…$`/`$$…$$` 수식이다. 모르는 문법은 텍스트로 보존한다.
- 이미지는 `root/assets/<sha256>.<ext>`에 둔다. pdf와 같은 불변·중복 금지 규칙을 쓰고, 본문 참조는 `assets/<sha256>.<ext>`로 정규화한다.
- 근거: 두 앱 모두 이미 `.md`를 쓰고, 데스크톱의 저장 단위도 문서 전체다. Swift 쪽에 CRDT 의존성을 추가하지 않아도 된다.
- 검토했지만 택하지 않은 대안:
  - 문단 ID 기반 LWW: 두 에디터 모두 안정적인 블록 ID가 필요하다.
  - Yjs/Automerge: 양쪽에 같은 라이브러리가 필요하다.
  - 둘 다 병합 품질은 더 좋지만 v1 비용이 크다.

---

## 3. PDF 뷰어와 필기

### 3.1 라이브러리

- 렌더러는 `react-pdf` 10.5의 `<Page>`를 쓰고 그 아래는 `pdfjs-dist` 5.4.296이다(`src/renderer/src/features/pdf/PdfPageView.tsx:20,423`, 워커는 `pdfWorker.ts`).
- 텍스트 레이어는 켜고 PDF 주석 레이어는 끈다(`PdfPageView.tsx:427-428`).
- main에서는 `pdf-lib` 1.17로 내보내기, 노트 생성, 페이지 재구성을 한다.

### 3.2 필기 기능, 저장 형식, 좌표계

- 필기 기능은 이미 있다. 표시 전용 수준이 아니라 편집이 된다.
  - 도구: 펜(`ink`, `fixedWidth`=볼펜), 형광펜(multiply 블렌드, `src/renderer/src/features/ink/ink.css:25-28`), 도형 4종, 리치 텍스트박스, 클립(다른 PDF 영역 참조), 이미지
  - 지우개는 객체 단위다. 닿은 획의 id를 모아 통째로 삭제한다(`InkLayer.tsx:510-545`).
  - 선택한 객체는 이동, 크기 변경, 색 변경을 할 수 있다(`drawings:update`).
- 구조: 페이지 캔버스 위에 `DrawingLayer` → `InkLayer` SVG를 겹친다(`PdfPageView.tsx:457`, `tools/DrawingLayer.tsx:89`). 획 외곽은 공유 알고리즘 inkV2~V5로 만든다(`src/shared/inkV5.ts`: 압력 필터와 테이퍼). 옛 획은 perfect-freehand로 그린다.
- 저장 형식은 `pdf_drawings` 한 행이 객체 하나다(`src/shared/types/drawing.ts`).
  - `data_json` = `{inkVersion?: 2..5, points: [{x, y, p, t?, tiltX?, tiltY?}], box?, text?, textRuns?, clip?, image?}`
  - `style_json` = `{color: <이름>, width: <페이지 폭 비율>, opacity, fixedWidth?, …}`
- 좌표계: PDF.js가 표시하는 회전 후 CropBox 기준으로 0..1 정규화하고, 원점은 좌상단이다. 두께도 표시 페이지 폭 비율이다(`drawing.ts:9-12`).
- 입력 샘플(`src/renderer/src/features/ink/inkGeometry.ts:28-43`):
  - x, y, p만 기록한다. 압력 0은 0.5로 바꾼다.
  - 데스크톱 입력은 기울기와 시각을 기록하지 않는다. 그 필드는 가져온 데이터에서만 채워진다.
  - `getCoalescedEvents`를 쓰지 않으므로 샘플 밀도는 pointermove 빈도로 정해진다.
- 색: 이름 토큰 7종을 PDF 화면에서 고정 팔레트로 매핑한다(`ink.css:3-12`). 따라서 결정적 hex 변환이 가능하다.
  - ink `#14171f`, red `#d6242e`, orange `#f06314`, yellow `#f5b80a`, green `#1a944d`, blue `#1461e0`, violet `#7d36d1`
  - 투명도는 `opacity`에 따로 둔다.

### 3.3 공통 스펙과의 차이 (SyncAdapter가 처리할 것)

| 항목 | 스펙 v1 | 데스크톱 | 처리 |
|---|---|---|---|
| 좌표 기준 | MediaBox, 회전 후, pt, 좌상단 | 표시 CropBox(회전 후), 0..1, 좌상단 | 곱셈 변환. MediaBox를 유지하면 crop 원점 오프셋이 추가로 필요하다(9장 제안 1) |
| 두께 | `width` pt. 표시 두께 = width × (0.5 + p) | 페이지 폭 비율. V5 지름 계수(약 0.24 + 0.68·p^0.8)와 테이퍼 | 환산 계수가 필요하다. 같은 획이 두 앱에서 조금 다르게 보이는 것은 v1에서 감수 |
| 색 | 임의 `#rrggbbaa` | 이름 7종 + opacity | 보내기는 표 매핑. 받기는 임의 색을 저장할 곳이 없으므로 `DrawingStyle`에 hex 필드를 추가해야 한다(스키마 확장) |
| 도구 | pen / highlighter / pencil | ink(+볼펜) / highlighter | pencil은 pen으로 표시. 볼펜(고정 폭)은 스펙에 표현할 수 없다 |
| 샘플 | `[x, y, p, tilt_az?, tilt_alt?, t_ms?]` | `{x, y, p, t?, tiltX?, tiltY?}` | 기울기 변환 공식, `t_ms` 기준(절대 시각인지 획 시작 기준인지) 확인 필요 |
| 획 수정 | 없음(id 합집합 + `del`) | 이동, 크기, 색 변경 | 스펙에 의미론이 없다(9장 제안 4) |
| 획 외 객체 | 없음 | 도형 4종, 텍스트박스, 클립, 이미지, 텍스트 강조 | v1에서는 동기화하지 않음(데스크톱 전용), 또는 스펙 확장 |
| 페이지 | `page_id` | 1-based 번호 | 매핑 테이블(1.3) |
| 시간과 삭제 | `t`, `del` ms epoch | `created_at`/`updated_at`/`deleted_at` ISO | 단순 변환 |

### 3.4 오버레이

새로 만들 필요가 없다. 페이지마다 정규화 좌표를 받는 SVG 레이어가 이미 있다. P1 "표시만"은 원격 획을 읽기 전용 레이어로 같은 자리에 그리는 것으로 충분하다.

### 3.5 PDF 원본을 다시 쓰는 경로

- PDF 탭의 페이지 패널(`src/renderer/src/features/pdf/PdfPagesPanel.tsx`)에서 페이지 재배치, 삭제, 복제, 회전, 빈 페이지 삽입을 할 수 있다. 이 작업은 `pdfNotes.restructure`(`src/main/features/pdf/pdfNotes.ts:61-183`)로 처리된다.
  - **같은 경로에 새 PDF 바이트를 쓴다.**
  - 이전 바이트는 `PDFOriginals/<sha>.pdf`로 보존한다.
  - 필기, 강조, 녹음 앵커의 페이지 번호를 다시 매핑한다.
- 스펙 모델(불변 `pdf/<sha256>.pdf` + `page_ids[]`)과 맞추려면 재구성 1회를 다음처럼 내보내야 한다.
  - 새 sha의 PDF
  - 새 `doc.upsert`(바뀐 `pdf_sha256`, `page_ids` 순서)
  - 옮겨진 페이지는 기존 `page_id`를 유지하고, 빈 페이지는 새 id를 받는다
  - 회전은 새 바이트에 이미 반영돼 있다
- 이것만으로는 iPad가 같은 페이지를 "PDF의 몇 쪽"으로 그릴지 알 수 없다. 9장 제안 2(`pdf_page` 필드)가 필요하다.

---

## 4. 로그인

### 4.1 버튼별 URL (실측)

세 버튼은 코드 경로가 같다. `AccountAccessGate.tsx:46-50` → IPC `auth:signIn` → `authService.signIn()` → `client.auth.signInWithOAuth({ provider, options: { redirectTo: 'bandal://auth/callback', skipBrowserRedirect: true } })`를 거쳐 받은 URL을 `shell.openExternal`로 연다(`src/main/features/account/authService.ts:351-401`). 프로바이더별 분기는 없다.

| 버튼 | 시스템 브라우저가 여는 URL | 서버 응답 (2026-10-29) |
|---|---|---|
| Google | `https://ukacrkcwiqafwpppshxb.supabase.co/auth/v1/authorize?provider=google&redirect_to=bandal://auth/callback&code_challenge=…` | 302 → accounts.google.com, `redirect_uri=https://auth.bandal.io/auth/v1/callback` ✓ |
| Kakao | 같은 URL, `provider=kakao` | **400** `Unsupported provider: provider is not enabled` |
| Apple | 같은 URL, `provider=apple` | **400** `Unsupported provider: missing OAuth secret` |

- 앱이 쓰는 API 호스트는 빌드할 때 구워진다(`MAIN_VITE_SUPABASE_URL`). 설치본 0.92.5의 asar에서도 `https://ukacrkcwiqafwpppshxb.supabase.co`를 확인했다. `auth.bandal.app` 문자열은 코드와 번들 어디에도 없다.
- 실제 커스텀 도메인은 `auth.bandal.io`다(CNAME → `ukacrkcwiqafwpppshxb.supabase.co`). Supabase가 이 도메인을 OAuth 콜백으로 쓰고 있어서 Google 동의 화면에 이 도메인이 보인다.
- "Kakao만 supabase.co로 간다"는 관찰의 원인은 이렇게 추정한다. 세 버튼 모두 supabase.co에서 시작하지만, Kakao는 거기서 바로 JSON 오류가 나서 그 주소에 머문다. 그래서 차이로 보였을 것이다.
- iPad도 같은 프로젝트 URL을 쓴다(`bandal-iPad/App/Resources/Configuration.plist:8`).
- 로그인 수단 연결(`linkIdentity`)도 같은 패턴이다(`authService.ts:308-317`).

### 4.2 Supabase 클라이언트

`src/main/features/account/supabaseClient.ts:23-33`
- `flowType: 'pkce'`, `detectSessionInUrl: false`, `persistSession: true`, `autoRefreshToken: true`, 커스텀 storage, 헤더 `x-bandal-client: desktop`
- supabase-js와 auth-js는 2.112.1이다. main에서만 지연 생성하며 렌더러는 토큰을 보지 못한다.
- 설정 키가 없으면 `null`(phase `unconfigured`)이 된다(`src/main/features/account/config.ts`).

### 4.3 세션 저장

- supabase-js storage 봉투 전체를 하나의 파일에 담는다. 세션과 PKCE `code_verifier`가 여기에 들어간다.
- 이 JSON을 `safeStorage`로 암호화한다(mac은 키체인의 "bandal Safe Storage" 키, Windows는 DPAPI). 쓰기는 tmp→rename 원자 쓰기이고 권한은 0600이다(`sessionStore.ts`).
- 암호화를 쓸 수 없으면 메모리에만 둔다.
- 세션 파일이 없으면 키체인에 접근하지 않는다. 그래서 로그아웃 상태로 실행할 때는 키체인 프롬프트가 뜨지 않는다.
- E2E는 `BANDAL_DISABLE_SAFE_STORAGE=1`로 이 저장소를 끈다(`src/main/lib/safeStorageGate.ts`).
- 로컬 접근 영수증 `profile-access.json`은 별도 파일이다: `{version, profileID, boundUserID, verifiedAt, locked}`.

### 4.4 리프레시 실패 시

- main(non-browser 환경)에서는 auth-js의 자동 갱신 타이머가 항상 돈다(auth-js `GoTrueClient.js:4690-4694`).
- 네트워크 오류: 재시도 대상이므로 세션을 유지한다.
- 리프레시 토큰이 만료되거나 폐기된 경우(재시도 불가 오류): auth-js가 세션을 지우고 SIGNED_OUT을 보낸다. 그러면 `authService.ts:144-150`이 로그아웃 상태를 발행한다.
  - 영수증은 바뀌지 않으므로 로컬 자료는 계속 열린다.
  - 기존 동기화만 "로그인해 주세요" 오류로 백오프에 들어간다.
- 시작 시 `restore()`(`authService.ts:319-349`): 세션이 없거나 오류가 나도 앱을 막지 않고 로그아웃 상태로 계속한다.
- `adoptSession()`의 `getUser` 검증이 네트워크 오류로 실패할 때:
  - 영수증이 이미 허용 상태면 오프라인 로그인으로 진행한다.
  - 아니면 `network` 오류가 된다(`authService.ts:196-204`).

### 4.5 로그인 없이 쓸 수 있는가: 없다

- 앱이 열리는 조건은 영수증의 `verifiedAt != null && locked == false`다(`localAccessStore.ts:61`).
- 새 영수증은 `locked: true, verifiedAt: null`로 시작한다(`:33`).
- 잠금은 온라인 로그인 + `getUser` 검증으로만 풀린다(`acceptVerified`/`confirm`).
- 게이트 위치는 두 곳이다.
  - 렌더러: `src/renderer/src/main.tsx:25` (`<AccountAccessGate><AppShell/></AccountAccessGate>`)
  - main: IPC 래퍼 `src/main/ipc/registerHandlers.ts:322,351`, 미디어 프로토콜 `:658`
- Supabase 키가 없는 빌드는 영구 차단된다. 게이트가 "이 설치본에 로그인 설정이 없습니다"를 보여 주고 끝이다. `config.ts:9-12`의 "키 없는 빌드도 1급 상태" 주석과 어긋난다.
- 기존 사용자 업그레이드: `ipad-companion/preferences.json`의 `boundUserID`를 영수증으로 옮기지만, 잠금 상태로 시작하므로 로그인을 한 번 해야 한다(`localAccessStore.ts:40-48`).

### 4.6 로그인이 실제로 막는 기능

A. **영수증이 없을 때(첫 실행, 새 기기, 새 프로필, 로그아웃 뒤)** 아래를 뺀 전부가 막힌다(`registerHandlers.ts:322`).
- 예외: `auth:*`, `profile:*`(백업, 새 프로필), `update:*`, `settings:get`, `window:getState`, `app:diagnostics`, `app:openLogs`, `feedback:send`, `workspace:transitionReady`
- `bandal-media://` 미디어 스트리밍도 막힌다.
- 앱 메뉴 "iPad › iPad로 자료 내보내기"는 접근 검사를 하지 않아 동작한다.

B. **영수증이 있으면(오프라인 가능)** 편집과 AI 등 로컬 기능은 모두 쓸 수 있다. 다음은 세션까지 있어야 한다(`account.getClient()`가 null이 아닐 때).
- 기존 iPad 동기화(자동, 지금, 충돌 해결). 쓰기는 서버 쪽 Paddle 구독도 필요하다(`docs/sync-paid-access.md`).
- 구독 상태(`billing:*`), 계정 삭제, 닉네임, 로그인 수단 연결
- 커뮤니티, 스터디 마켓, 플러그인 마켓플레이스 등록·제출(`registerHandlers.ts:3331-3365`)
- 피드백 보내기(`feedbackService.ts:60-61`: 클라이언트가 없으면 `unavailable`). `registerHandlers.ts`의 "로그인 전에도 가능" 주석은 현재 사실과 다르다.
- `.bandalpack` 가져오기는 세션 없이 영수증만 있으면 된다.

### 4.7 콘솔 상태 메모 (전체 목록은 2·3단계 산출물)

- Supabase Auth의 Kakao: 비활성
- Supabase Auth의 Apple: OAuth 시크릿 없음. 웹 플로용 client secret JWT는 최대 6개월마다 갱신해야 한다.
- Google: 정상
- Redirect URL `bandal://auth/callback`: Google 왕복이 되므로 등록된 것으로 보인다.

---

## 5. 딥링크 `bandal://auth/callback`

| 항목 | 상태 | 근거 |
|---|---|---|
| 파서 | code / cancelled / failed / ignored로 분류한다. 코드가 든 URL은 로그에 남기지 않는다 | `src/main/features/account/authCallbackUrl.ts` |
| mac 패키지 등록 | electron-builder `protocols` → Info.plist `CFBundleURLTypes`. 설치본에서 `CFBundleURLSchemes=[bandal]`을 확인했다 | `electron-builder.yml:83-86` |
| mac `open-url` | `whenReady` 전에 등록한다. `deepLinkQueue`가 렌더러 로드 전까지 버퍼링하고, `did-finish-load` 또는 `did-fail-load` 때 전달한다 | `src/main/index.ts:135-139,384-389`, `src/main/deepLinkQueue.ts` |
| single instance | `requestSingleInstanceLock()`. 활성 프로필 userData를 정한 뒤에 호출하므로 락은 프로필 경로 범위다 | `index.ts:72-74,103` |
| Windows 콜드 스타트 | `findDeepLinkArg(process.argv)` | `index.ts:142-143` |
| Windows 실행 중 | `second-instance`의 argv에서 URL을 찾아 큐에 넣고 기존 창을 보여 준다(`createMainWindow`가 기존 창 재사용) | `index.ts:145-151`, `src/main/windows/mainWindow.ts:90-93` |
| Windows 스킴 등록 | **NSIS 설치기는 등록하지 않는다.** app-builder-lib 26.15.7에서 `protocols`를 읽는 곳은 `electronMac.js`, `AppxTarget.js`, `LinuxTargetHelper.js`뿐이다. 실제 등록은 앱이 실행될 때마다 하는 `app.setAsDefaultProtocolClient('bandal')`(HKCU)이다. 따라서 설치 후 한 번은 실행해야 하고, 제거 후 키가 남을 수 있다. yml 78-80행 주석("Windows는 설치기 레지스트리")은 사실과 다르다 | `index.ts:120-130` |
| 개발 모드 | `process.defaultApp`이면 `setAsDefaultProtocolClient('bandal', execPath, [엔트리 절대경로])`. mac은 스킴이 `Electron.app` 번들에 붙어 불안정하고, 설치본과 스킴을 번갈아 빼앗는다. Windows dev도 같은 HKCU 키를 덮어쓴다 | `index.ts:111-129`, `docs/oauth-setup.md` §6 |
| 중복·경합 콜백 | 세션이 이미 있으면 무시한다. 사용한 code는 다시 쓰지 않는다. 교환 중인 code가 가드 역할을 한다 | `authService.ts:419-499` |
| PKCE verifier | 첫 인스턴스의 저장소(파일 또는 메모리)에 있다. Windows에서 콜백을 실은 두 번째 인스턴스는 락에 막혀 종료되고, 첫 인스턴스가 교환한다 | |
| E2E 프로브 모드 | 스킴을 등록하지 않고 딥링크도 무시한다 | `index.ts:130,137,143,149` |

깨끗한 Windows에서 실제로 왕복해 본 기록은 없다. 지금은 Kakao와 Apple이 서버 설정 때문에 플랫폼과 무관하게 실패한다.

---

## 6. 오프라인과 세션 만료

| 상황 | 로컬 자료 | 근거 |
|---|---|---|
| 액세스 토큰 만료, 오프라인 | 열림 | 영수증 유지 |
| 리프레시 토큰 만료·폐기 | **열림.** 로그아웃 상태로 표시되고 동기화만 멈춘다 | 4.4 |
| 첫 실행, 새 기기, 새 프로필 | **막힘.** 온라인 로그인이 필요하다 | `localAccessStore.ts:33` |
| 명시적 로그아웃 | **막힘.** `lock()` 이후 재로그인 전까지 앱 전체가 막힌다. 오프라인이면 풀 방법이 없다 | `authService.ts:501-502`, `localAccessStore.ts:64,75` |
| 다른 계정으로 로그인 | **막힘.** `profile-mismatch`가 나고 새 프로필이 필요하다 | `localAccessStore.ts:67` |
| `profile-access.json` 손상 | **막힘**(fail closed). 백업이나 새 프로필만 할 수 있다 | `localAccessStore.ts:35-38`, `e2e/accountProfileBackup.spec.ts:96` |
| Supabase 키 없는 빌드 | **영구히 막힘** | 4.5 |
| 백업 진행 중 | 일시 차단 | `registerHandlers.ts:351` |

검토 항목 "리프레시 토큰 만료 상태에서 로컬 자료가 보이는가"에 대한 코드상 답은 **보인다**이다. 다만 로그아웃이나 첫 실행 경로는 막힌다. 실행 검증은 3단계 (g)에서 한다.

---

## 7. 빌드와 서명

### macOS
- `electron-builder.yml:95-157`
  - dmg와 zip, arm64와 x64
  - hardened runtime, 공증(App Store Connect API 키)
  - Developer ID 서명은 `scripts/sign-mac.mjs`가 하며, 공유 확장을 먼저 서명한 뒤 osx-sign을 돌린다.
  - appId `com.bandal.app`
- 엔타이틀먼트 파일은 세 개다.
  - `resources/entitlements.mac.plist`(entitlementsInherit): 캘린더, 마이크, allow-jit, allow-unsigned-executable-memory, disable-library-validation, allow-dyld-environment-variables. 샌드박스는 없다.
  - `resources/native/share-extension/entitlements.main.plist`(메인 앱): beforePack 단계에서 `scripts/build-share-extension.mjs:26-28`이 생성한다. 위 내용에 `com.apple.security.application-groups` = `<APPLE_TEAM_ID>.com.bandal.shared`가 더해진다. 리포에 들어 있는 사본은 `LOCAL.` 자리표시자다.
  - 확장용: `resources/native/share-extension/<arch>/entitlements.extension.plist`(샌드박스 + 사용자 선택 읽기 + App Group)
- **프로비저닝 프로파일은 없다.** yml에 키가 없고 파일도 없다. 팀 접두사 App Group은 프로파일 없이 동작한다(`build-share-extension.mjs:12-14`).
- **iCloud 엔타이틀먼트도 없다.** 메인 앱에 `icloud-container-identifiers`, `ubiquity-container-identifiers`, `icloud-services`가 없다. 이 키들을 붙이려면 Developer ID 프로비저닝 프로파일이 필요하다. 비용은 2단계에서 조사한다.
- 데스크톱 서명 팀 ID는 CI 시크릿(`release.yml:381`)이라 확인하지 못했다. iPad 팀은 `VUZ7Z98BW3`이다(`bandal-iPad/project.yml:26`). 엔타이틀먼트 방식으로 iCloud 컨테이너를 공유하려면 같은 팀이어야 하므로 확인이 필요하다.

### Windows
- NSIS x64만 빌드한다. 사용자별 설치이고 **코드 서명은 하지 않는다**(SmartScreen 경고가 뜬다)(`electron-builder.yml:159-185`). arm64 빌드는 없다.

### 함께 패키징되는 네이티브 도우미
- ipad-bridge(PyInstaller, `scripts/build-ipad-bridge.mjs`), calendar, browser-import, photo-picker, 공유 확장

### iPad 쪽
- 번들 `app.bandal.ipad`이고 엔타이틀먼트는 `com.apple.developer.applesignin` 하나뿐이다(`bandal-iPad/App/Bandal.entitlements`).
- 이 Mac의 `~/Library/Mobile Documents/`에는 `iCloud~app~bandal~ipad`가 없다.

---

## 8. 새 원칙과 충돌하는 기존 코드

| 위치 | 내용 | 충돌하는 원칙 |
|---|---|---|
| `src/renderer/src/features/account/AccountAccessGate.tsx`, `src/renderer/src/main.tsx:25`, `src/main/ipc/registerHandlers.ts:322,351,658`, `src/main/features/account/localAccessStore.ts` | 필수 로그인 게이트와 계정 바인딩 영수증 | 원칙 1 |
| `src/main/features/ipadSync/runtime.ts`, `resources/ipad-bridge/*`(bridge.py, backend.js 7.5MB, projector-host.cjs), `resources/native/ipad-bridge/*`, `scripts/build-ipad-bridge.mjs`, `src/main/menu.ts:152` "iPad" 메뉴, IPC `runtime:sync*` | Supabase RPC `bandal_push`/`bandal_pull`와 Storage `bandal-assets`를 쓰는 동기화. 계정에 바인딩된다 | Supabase 업로드 금지, 원칙 2 |
| `src/renderer/src/features/settings/BillingSyncPanel.tsx`, IPC `billing:*`(`registerHandlers.ts:3799-3812`), 메뉴 "구독 관리…" | Paddle 구독과 5 GiB 쿼터 UI | 구독은 iPad 전용 |
| 서버: `supabase/` personal sync 마이그레이션, `docs/sync-paid-access.md` | 서버 쪽 레코드, 버킷, 과금 원장 | 기존 업로드 자료의 처리 방침이 필요하다 |
| `.bandalpack` 내보내기·가져오기 | 로컬 파일 전송이라 서버가 필요 없다. 다만 같은 Python 브리지를 쓴다 | 충돌은 없다. 유지할지는 선택 |

기존 동기화를 켰던 사용자의 자료가 이미 Supabase에 있다. "마이그레이션 경로 없이 바꾸지 않는다" 원칙상 철거 순서를 정해야 한다(11장 결정 1).

---

## 9. 공통 스펙 변경 제안 후보 (변경 제안서로 올릴 것)

1. **좌표 기준을 MediaBox에서 CropBox(회전 후)로 바꾼다.** 데스크톱(`drawing.ts:9-12`)과 iPad의 기존 구현(`App/PDF/PortableInk.swift:90-99`, `App/Native/Storage/NativeSyncInkGeometry.swift:20`)이 모두 CropBox를 쓰고, 사용자가 보고 그리는 영역도 CropBox다. MediaBox를 유지하면 잘린 PDF에서 양쪽 다 오프셋 변환이 필요하고 `page.size`의 의미도 모호해진다.
2. **`page.upsert`에 원본 PDF 쪽 번호 `pdf_page`(빈 페이지는 null)를 추가한다.** `index`(표시 순서)만으로는 재배치된 문서에서 페이지가 PDF의 몇 쪽인지 알 수 없다.
3. **필기 노트의 종이를 표현한다.** `paper`(blank/lines/grid/dots)와 `surface`(light/dark)를 추가한다. 이게 없으면 iPad에서 만든 PDF 없는 노트를 데스크톱이 빈 흰 페이지로 그리게 된다.
4. **획 편집 의미론을 정한다.** 권장안은 "이동, 크기, 색 변경 = 기존 id `del` + 새 id 생성"이고, 이 경우 스펙은 바꾸지 않아도 된다. 대안은 획에 수정 시각 필드를 두고 LWW로 처리하는 것이다.
5. **텍스트 노트용 `type:"text"`와 파일 규약을 추가한다**(2.2).
6. **폴더 계층을 정한다.** 데스크톱 과목 폴더에는 하위 폴더가 있으므로 `doc.upsert`에 `folder` 경로 필드를 두거나, 평탄화 규칙을 정해야 한다.
7. **범위 밖 데이터를 명시한다.** 도형, 텍스트박스, 클립, 이미지 객체, 텍스트 강조, PDF가 아닌 자료(이미지, 오피스, 녹음)는 v1에서 동기화하지 않는다고 적는다.
8. **모호한 부분을 정의한다.** `t_ms`가 절대 시각인지 획 시작 기준인지, `tilt_az`/`tilt_alt`의 단위와 기준축을 적는다.
9. (선택) `course.upsert`에 `color`와 `archived`를 추가한다.

---

## 10. 반드시 답해야 할 검토 항목: 현재 답과 확인 계획

| 항목 | 지금 알 수 있는 것 | 언제, 어떻게 |
|---|---|---|
| mac에서 엔타이틀먼트 없이 쓴 파일이 iPad까지 올라가는가 | 지금은 실험할 수 없다. 이 Mac에는 `iCloud~app~bandal~ipad` 폴더가 없고, iPad 앱에는 iCloud 엔타이틀먼트가 없다. Obsidian 방식(엔타이틀먼트 없이 폴더를 직접 읽고 쓰기)이 이미 있는 폴더에 쓰는 데에 그 엔타이틀먼트가 필요한지는 확인하지 못했다. 다만 그 폴더는 iPad 앱이 iCloud Documents 컨테이너(`iCloud.app.bandal.ipad`)를 켜고 실행돼야 생긴다 | 2단계 초반, 위 조건이 갖춰진 뒤 실측 |
| iCloud 폴더 감시가 안정적인가 | chokidar 4.0.3이 이미 자료 감시에 쓰이고 있다(`src/main/features/materials/watcher.ts`). 이 Mac에서 `~/Documents/Bandal` 파일의 58%(83/142)가 dataless이므로, 해시나 열기를 할 때마다 다운로드가 일어날 수 있다는 전제를 둬야 한다 | 3단계 (c), 이벤트 누락 계측 테스트 |
| Windows + iCloud for Windows | 관련 코드가 없다 | 3단계 (h), 수동 |
| Drive `changes.list` 쿼터 | 2026-05-01부터 쿼터 단위제다. 사용자·프로젝트당 분당 325,000, 프로젝트당 분당 1,000,000, 하루 400,000,000 units를 넘으면 과금 예정이다. `changes.list` 단가는 문서에 없다(목록류 100 ~ 읽기류 5로 범위 추정). 세부 계산은 표 아래 | 2단계 설계 + Cloud Console에서 단가 실측 |
| 두 기기 오프라인 수정 후 머지 시 획 손실 0 | 스펙의 합집합 규칙으로는 생성과 삭제에서 손실이 없다. 위험은 (a) 데스크톱의 획 편집(같은 id에 다른 내용, 9장 제안 4), (b) 재구성에 따른 페이지 재매핑(제안 2)이다 | 3단계 (b), sync-fixtures 테스트 |
| 깨끗한 Windows에서 설치 → 3종 로그인 → 딥링크 복귀 | Kakao와 Apple은 서버에서 실패한다(4.1). NSIS가 스킴을 등록하지 않으므로 첫 실행 뒤에만 콜백을 받을 수 있다 | 콘솔 설정 뒤 3단계 (h) |
| 리프레시 토큰 만료 상태에서 로컬 자료가 보이는가 | 코드상 보인다. 단 첫 실행과 로그아웃 뒤는 막힌다(6장) | 3단계 (g) 실측 |

Drive 쿼터 계산 (기기 2대, 하루 사용 기준)
- 호출 수
  - 30초 폴링은 기기당 시간당 120회다.
  - 8시간 사용 기준 하루 1,920회, 24시간 켜 두면 5,760회다.
- 분당 사용량: 사용자당 최대 400 units로, 사용자당 분당 한도와 비교할 필요가 없는 수준이다.
- 프로젝트 분당 한도 1,000,000 units
  - 단가 100이면 동시에 켜진 기기 약 5,000대에서 막힌다.
  - 단가 5면 약 100,000대에서 막힌다.
- 하루 과금 임계 400M units
  - 단가 100: 8시간 사용 기준 약 2,080명, 24시간 기준 약 690명에서 넘는다.
  - 단가 5: 각각 약 41,700명, 13,900명이다.
- 비용은 사용자가 아니라 반달의 Google Cloud 프로젝트가 진다. 따라서 창이 보이지 않거나 유휴일 때 폴링 간격을 늘리는 설계가 필요하다.
- 2025-11~2026-04에 Drive API를 쓴 프로젝트만 예전 쿼터를 유지한다. 새로 켜면 새 쿼터가 적용된다.
- 출처: https://developers.google.com/workspace/drive/api/guides/limits (2026-09-11 갱신)

---

## 11. 2단계 설계 전에 정할 것

1. **기존 Supabase 동기화와 Paddle 구독 UI를 언제 철거할지.** 선택지는 즉시 제거, 새 동기화 출시와 동시 제거, 읽기 전용 이전 도구로 한시 유지다. 서버에 이미 올라간 사용자 자료를 어떻게 처리할지도 함께 정해야 한다.
2. **프로필 개념을 유지할지.** 제안: 유지하되 "동기화 바인딩 단위"(프로필 1개 ↔ 클라우드 폴더 1개)로만 쓴다. 계정 바인딩과 그에 따른 잠금은 제거한다.
3. **v1 동기화 범위.** 제안: 과목, PDF, 손필기(ink와 highlighter), 텍스트 노트. 도형, 텍스트박스, 강조, 기타 파일은 제외한다.
4. **데스크톱 필기 편집과 P1 "표시만"의 관계.** 데스크톱에는 이미 편집 기능이 있다. 제안: 데스크톱에서 그린 획도 내보내되, 생성과 삭제만 내보낸다. 이동과 색 변경은 del + 새 id로 처리한다.
5. **동기화 대상 PDF의 페이지 재구성 기능을 어떻게 할지.** 매핑해서 내보내거나, 동기화 문서에서는 끈다.
6. 9장 스펙 변경 제안을 iPad 팀과 합의하는 경로.

---

## 부록 A. 재현 명령

```sh
# 버튼별 OAuth 리디렉트 (로그인을 끝까지 진행하지 않음, PKCE 없이)
for p in google kakao apple; do
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
    "https://ukacrkcwiqafwpppshxb.supabase.co/auth/v1/authorize?provider=$p&redirect_to=bandal%3A%2F%2Fauth%2Fcallback"
done

# 설치본에 구워진 Supabase 호스트
grep -a -o 'MAIN_VITE_SUPABASE_URL[^,;]\{0,80\}' /Applications/Bandal.app/Contents/Resources/app.asar

# 자료 폴더의 iCloud 플레이스홀더 수
find ~/Documents/Bandal -type f -flags +dataless | wc -l

# NSIS가 protocols를 쓰지 않는지
grep -rln protocols node_modules/.pnpm/app-builder-lib@26.15.7*/node_modules/app-builder-lib/out \
  node_modules/.pnpm/app-builder-lib@26.15.7*/node_modules/app-builder-lib/templates/nsis
```
