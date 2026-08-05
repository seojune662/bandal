# 반달 개선 백로그

> MVP(단위 342 + E2E 7 그린, dmg 빌드 성공) 이후의 제품 품질 감사 결과.
> 감사일 2026-08-05 · 대상 커밋의 `src/**`, `docs/**`, `release/mac-arm64/Bandal.app`.
>
> **표기** — 심각도: `P0` 매일 쓰는 데 지장 / `P1` 아프다 / `P2` 다듬기 / `P3` 있으면 좋다.
> 크기: `S` 한나절 / `M` 1~3일 / `L` 그 이상.
> 근거 없는 항목은 **미확인**으로 명시했다. 코드 지적은 전부 `파일:줄` 근거가 있다.
>
> **감사 방법의 한계** — 이 환경에서는 앱을 GUI로 띄우지 못했다
> (`better-sqlite3` 모듈 로드가 재현 가능하게 `EINTR`로 실패, 3회 재시도 동일).
> 따라서 **실사용 관찰 기반 항목은 없고**, 전부 코드 정독·빌드 산출물 검사·
> 정적 검증으로 얻은 것이다. 실행 확인이 필요한 항목은 그때그때 표시했다.
> 역설적으로 그 실패가 아래 1순위 버그를 드러냈다.

---

## 지금 당장 고칠 상위 10개

앞쪽 4개는 반나절짜리인데 데이터 손실·완전 정지를 막는다. 순서대로 집으면 된다.

| # | 제목 | 심각도 | 크기 | 근거 | 상세 |
|---|---|---|---|---|---|
| 1 | 하이라이트 메모가 팝오버 닫힐 때 조용히 사라진다 | P0 | S | `features/pdf/popovers.tsx:36-49`, `130-134` | §3.1 |
| 2 | DB 열기에 실패하면 창이 아예 뜨지 않는다 (아무 안내도 없음) | P0 | S | `main/index.ts:25-45`, `main/db/database.ts:59-64` | §1.1 |
| 3 | 필기 편집기에 undo/redo가 없다 | P0 | S | `package.json:22-28`(plugin-history 부재), `features/notes/NoteTab.tsx:99` | §4.1 |
| 4 | 자료를 키보드로 열 수 없다 (파일은 더블클릭 전용) | P0 | S | `features/materials/MaterialTree.tsx:64-71`, `:145` | §2.11 |
| 5 | AI 튜터가 과목 폴더 밖 파일을 사전 승인 없이 쓸 수 있다 | P0 | M | `agent/claude/ClaudeCodeAdapter.ts:31-40`, `93-98` | §5.1 |
| 6 | 자료 폴더를 깊이·개수 제한 없이 **동기**로 훑는다 → 메인 프로세스 프리즈 | P0 | M | `materials/materialsRepo.ts:64-98`, `ipc/registerHandlers.ts:137` | §2.2 |
| 7 | 「보관」한 과목을 되돌릴 UI가 없다 (사실상 삭제) | P0 | M | `stores/coursesStore.ts:222`, `settings/SettingsApp.tsx:488-497` | §2.1 |
| 8 | 한글 파일명 NFD/NFC 미정규화 → 자료 검색이 0건으로 나온다 | P1 | S | `materials/materialsRepo.ts:186-188` | §2.3 |
| 9 | `--text-muted`(두 테마)·라이트 `--accent`가 WCAG AA 미달 | P1 | S | 토큰 실측 3.35~4.09 / 3.40 | §10.4 |
| 10 | AI 사용 한도·오류가 화면에 전혀 표시되지 않는다 | P1 | S | `agent/claude/streamMapper.ts:348-382`, `chat/chatModel.ts:361-391` | §5.2 |

바로 다음 줄 (전부 `M`, 값이 크지만 하루 이상):

- **배포 서명·노터라이즈** (§11.1) — 학생에게 dmg를 줄 계획이 있다면 실질 P0다. 지금은 adhoc 서명이라 Gatekeeper가 막는다.
- **PDF 내 텍스트 검색** (§3.2) — 시험 전 복습 동선의 핵심인데 `PdfToolbar.tsx` 전체에 find 코드가 없다.
- **브라우저 UA + 다운로드 → 과목 폴더** (§6.1, §6.2) — 내장 브라우저가 존재하는 이유 자체가 이 둘이다.
- **다이얼로그 포커스 복원 + 트랩** (§10.2) — 12개 표면 전부 없다. 공용 훅 하나로 끝난다.

---

## 1. 온보딩 · 첫인상

**1.1 DB 열기 실패 = 창 없음, 안내 없음 · P0 · S**
`main/index.ts:25-45`의 `app.whenReady().then(...)` 체인에 `.catch`가 없다.
`initDatabase()`(`main/db/database.ts:59-64`)가 throw하면 `createMainWindow()`가
**호출되지 않은 채** UnhandledPromiseRejection만 남는다. 감사 중 실제로 재현했다:
Dock에 아이콘은 뜨고, 창은 영원히 안 나오고, 학생이 알 수 있는 정보는 0이다.
실사용에서 이 경로에 들어가는 원인: DB 파일 손상, 디스크 꽉 참, 권한 문제,
`~/Library/Application Support/bandal` 이 동기화/백업 도구에 잠김.
→ `dialog.showErrorBox` + "DB를 초기화하고 다시 시작" 옵션, 그리고 `whenReady` 체인 전체에 catch.
같은 이유로 `process.on('uncaughtException'/'unhandledRejection')` 핸들러도 없다(소스 0건).

**1.2 렌더러 에러 바운더리가 하나도 없다 · P1 · S**
`ErrorBoundary` / `componentDidCatch` / `getDerivedStateFromError` 소스 전체 0건.
`main.tsx`는 `<AppShell/>`을 그냥 렌더한다. 어떤 하위 컴포넌트가 던지면 React 18은
트리 전체를 언마운트 → **완전한 흰 화면**. 복구 수단은 앱 재시작뿐이고,
`render-process-gone` / `child-process-gone` 핸들러도 없어 렌더러가 죽어도 창이 빈 채로 남는다.
→ AppShell·탭 패널 단위 바운더리 + "이 탭을 다시 열기" 액션.

**1.3 온보딩 3단계가 AI를 터미널로 떠넘긴다 · P1 · M**
`features/onboarding/OnboardingOverlay.tsx:243-247` — "터미널에서 `claude`를 실행해
설치와 로그인을 마친 뒤 재확인을 눌러주세요."
헤드라인 기능인 AI 튜터의 유일한 안내가 이것이다. 터미널을 열어본 적 없는 학생은
여기서 끝난다. 설치 명령 복사 버튼도, 설치 문서 링크도, "Claude 구독이 필요하다"는
사실도 없다.
→ 설치 명령 복사 + `shell.openExternal`로 안내 문서 + (가능하면) 터미널 실행 버튼.

**1.4 온보딩이 "자료 넣기"를 가르치지 않는다 · P1 · S**
현재 3단계는 소개 → 과목 만들기 → AI 상태. 정작 두 번째로 하게 될 행동인
**강의자료 드래그**는 아무 데서도 안내되지 않는다. 자료 사이드바 빈 상태
문구(STYLEGUIDE §7)에만 있고, 온보딩 직후 학생은 빈 워크스페이스를 본다.
→ 4단계(선택) "자료 넣어보기" 또는 온보딩 종료 후 자료 레일 스포트라이트.

**1.5 데이터 폴더 위치를 알려주지도, 고르게 하지도 않는다 · P1 · M**
기본값은 `~/Documents/Bandal`(`main/settingsStore.ts:28-34`)이고 설정에서는
읽기 전용 + 「추후 변경 예정」 배지(`SettingsApp.tsx:206-208`)다.
이 머신에서 확인한 바 **iCloud Drive의 "데스크탑 및 문서" 동기화가 켜져 있다**
(`FXICloudDriveDocuments = 1`). 한국 대학생 상당수가 같은 상태다. 결과:
- 강의자료 전체가 학생 모르게 iCloud로 업로드된다(용량·프라이버시).
- 오프로드(dataless)된 PDF는 오프라인에서 열기 실패하고, `statSync`가 수 초 블로킹한다(→ §2.7).
- chokidar가 `.icloud` 플레이스홀더 생성/삭제를 파일 변경으로 본다.
→ 온보딩에서 폴더 위치를 보여주고 바꿀 수 있게 + iCloud 관리 경로면 경고 배너.

**1.6 온보딩 다이얼로그에 포커스 트랩·초기 포커스·포커스 복원이 없다 · P2 · S**
`OnboardingOverlay.tsx:293-298`은 `role="dialog" aria-modal="true"`만 선언한다.
Tab을 누르면 뒤쪽 앱 UI로 빠져나가고, 닫은 뒤 포커스가 어디로 가는지 정의되지 않았다.
2단계만 입력에 포커스를 준다(`:75-77`).

**1.7 프리플라이트 상태 변화에 `aria-live`가 없다 · P3 · S**
`AiStep`의 "확인하는 중…" → 결과 전환이 스크린리더에 알려지지 않는다
(`OnboardingOverlay.tsx:216-220`은 `role="status"`지만 결과 영역은 아니다).

---

## 2. 과목 · 자료

**2.1 「보관」이 편도다 · P0 · M**
`coursesRepo.archive`는 `archived: boolean`을 받고(`main/features/courses/coursesRepo.ts:309`),
`courses:list`는 `includeArchived`를 지원한다(`shared/ipc/contract.ts:53`).
그런데 렌더러는 `archived: true`만 보내고(`stores/coursesStore.ts:222`),
`includeArchived`를 넘기는 곳이 없다(`coursesStore.ts:65`). 보관된 과목이 보이는 유일한
곳은 설정 창의 **읽기 전용** 목록(`SettingsApp.tsx:488-497`)이고 해제 버튼이 없다.
학기말에 5과목을 정리하면 그 과목의 자료·하이라이트·필기·보드·대화에 앱 안에서
다시 도달할 방법이 사라진다. **백엔드는 이미 다 있다 — 레일에 「보관함」 섹션과
컨텍스트 메뉴 「보관 해제」만 붙이면 된다.**

**2.2 폴더 walk에 깊이·개수 제한이 없고 동기다 · P0 · M**
`materialsRepo.ts:64-98`의 `walkDir`은 무제한 재귀 + 파일마다 `statSync`(`:86`)이고,
메인 프로세스에서 동기 실행된다(`registerHandlers.ts:137`).
폴더 선택에 크기 가드가 없어(`courseFolder.ts:45-63`) 학생이 실수로 `~/Documents`나
`~/Desktop`을 과목 폴더로 고르면 그대로 통과한다. chokidar도 같은 트리를 깊이 제한
없이 감시하고(`watcher.ts:86`), 변경 이벤트마다 전체 walk가 다시 돈다
(`MaterialsSidebar.tsx:72-76`). 메인이 동기 블로킹되면 보드·채팅·PDF IPC가 전부 같이 멈춘다.
→ 깊이/노드 상한 + 선택 시 크기 경고 + walk 비동기화.

**2.3 한글 파일명 NFD/NFC 미정규화 · P1 · S**
소스 전체에서 `.normalize(` 호출은 `coursesRepo.ts:93`의 slugify 딱 한 곳이다.
검색 needle은 한글 IME 입력이라 **NFC**, haystack은 `readdirSync`가 준 이름
(Finder·압축 해제·구 툴이 만든 파일은 **NFD**)이 그대로 `materials_index.rel_path`에
들어가 `instr(lower(rel_path), ?)`로 비교된다(`materialsRepo.ts:186-188`).
결과: 트리에는 멀쩡히 보이는 "3주차_알고리즘.pdf"가 검색에서 0건.
학생 눈에는 검색 기능이 그냥 고장 난 것으로 보인다.
**인덱스는 매 검색마다 재생성되므로 마이그레이션도 필요 없다 — 양쪽에 `.normalize('NFC')`만.**
같은 이유로 하이라이트의 `annotations.rel_path`(`db/schema.sql:40`)도 정규화가 필요하다(**미확인**: 실제 재현은 못 했다).

**2.4 다운로드 중인 파일이 그대로 트리에 뜬다 · P1 · S**
`watcher.ts:86-92`에 `awaitWriteFinish`가 없다. 300ms 디바운스(`:53-56`)는 UI 갱신
디바운스지 쓰기 완료 대기가 아니다. 매주 반복되는 "강의자료 받아서 넣기" 동선에서
받는 중인 PDF를 열면 손상 파일로 실패한다.
→ `awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }`. 한 줄.

**2.5 트리에서 할 수 있는 게 거의 없다 · P1 · M~L**
materials IPC는 `tree / search / import / reveal / readFile / watch / unwatch` 7개가 전부다
(`shared/ipc/contract.ts:100-135`). **이름 변경·삭제·새 폴더·이동·다중 선택·정렬·드래그
재배치가 없고**, `MaterialTree.tsx`에는 컨텍스트 메뉴 자체가 없다. `reveal` 채널은
있는데 트리에서 호출하지 않는다(`MaterialTree.tsx:25-32`).
"3주차" 폴더를 만들어 정리하려면 Finder로 나가야 한다 — IDE라고 부르기 어려운 지점.

**2.6 드롭은 무조건 과목 루트로, 폴더는 아예 못 넣는다 · P1 · M**
`materials:import` 요청에 대상 디렉터리 파라미터가 없고(`contract.ts:110-113`),
구현도 `join(folder, targetName)` 루트 고정(`materialsRepo.ts:232`).
드롭 타겟도 사이드바 전체 하나(`MaterialsSidebar.tsx:36,106-107`).
`statSync(source).isFile()`이 false면 ValidationError라(`materialsRepo.ts:228`)
Finder에서 "3주차" 폴더를 통째로 끌면 "1개 실패" 토스트만 뜬다.
같은 이름 재다운로드는 `name (2).pdf`로 중복 생성(`:113-123`) — 덮어쓰기/건너뛰기 선택지 없음.
결과: 학기 내내 루트에 파일이 평면으로 쌓인다.

**2.7 `courses:list`가 과목마다 `statSync`+`accessSync`를 돈다 · P1 · M**
`rowToCourse`가 행마다 `folderState()`를 호출하고(`coursesRepo.ts:74`),
그게 `statSync`+`accessSync`다(`courseFolder.ts:47,57`). `list()`는 이걸 전 행에 대해 돈다(`:195`).
링크한 폴더가 외장 디스크·네트워크 볼륨·오프로드된 iCloud면 부팅 첫 IPC에서 멈춘다.
→ 상태를 비동기로 뒤늦게 채우고, 결과를 캐시.

**2.8 자료 검색이 매번 인덱스를 통째로 재구축한다 · P1 · M**
`search()` → `rebuildIndex()`(`materialsRepo.ts:181`) → 전체 walk + `DELETE`+파일 수만큼 `INSERT`(`:132-152`).
렌더러는 240ms 디바운스로 호출한다(`MaterialsSidebar.tsx:13,92-95`).
500개 파일 과목에서 한 글자 칠 때마다 500 statSync + 500 INSERT가 메인에서 동기로 돈다.
→ watcher 이벤트에서만 인덱스 갱신, 검색은 조회만.

**2.9 파일 이름을 바꾸면 하이라이트가 사라진 것처럼 보인다 · P1 · M**
watcher가 rename/unlink를 구분하지 않고 `'all'`을 한 콜백으로 뭉갠다(`watcher.ts:94`).
chokidar는 rename을 `unlink`+`add` 쌍으로 주는데 그 정보를 버린다.
`annotations.rel_path`는 문자열 경로라 Finder에서 이름만 바꿔도 그 PDF의 하이라이트가
전부 안 보인다. 실제로는 DB에 고아로 남아 있을 뿐인데, 학생은 필기를 잃었다고 인식한다.
→ rename 페어링 → `annotations`/`notes` 경로 마이그레이션, 또는 파일 식별자(inode/해시) 병기.

**2.10 가상화가 없다 · P1 · M**
`MaterialTree.tsx:114-126`은 평범한 재귀 `<ul>`/`<li>`이고 `react-window`류 의존성이 없다
(런타임 의존성 17개 전수 확인). 행 하나가 요소 6개 + svg → 루트 평면 500개면 3,000+ 요소.
검색 결과도 상한 없이 전부 렌더한다(`:133`).

**2.11 파일이 더블클릭으로만 열린다 · P1 · S**
`MaterialTree.tsx:64-71` — `onClick`은 폴더 토글만, 파일은 `onDoubleClick`만.
`role="tree"`/`treeitem`/`aria-level`/`aria-expanded`는 선언해 놓고
(`:53,87,115`) roving tabindex도 화살표 키도 없다. Enter/Space는 `<button>` 기본 click으로
들어오지만 파일에 대해선 아무 일도 안 한다 → **키보드로는 자료를 열 수 없다.**
ARIA를 선언했으면 그 상호작용 계약도 따라와야 한다.

**2.12 과목 삭제가 딸린 데이터를 고아로 남긴다 · P1 · M**
`softDelete`는 `courses.deleted_at`만 세팅한다(`coursesRepo.ts:323-332`).
`board_tasks`/`annotations`/`messages`/`agent_sessions`/`tabs_layout`/`materials_index`는
그대로 남고, 스키마에 `ON DELETE CASCADE`도 없다. 보드 카드는 영구히 「알 수 없음」이 되고
(`BoardPanel.tsx:164`) 필터 칩에도 안 잡혀(`:471`) 골라낼 수도 지울 수도 없다.
더 나쁜 건, 같은 폴더를 다시 추가하면 `selectLiveByFolder`가 `deleted_at IS NULL`로 거르므로
(`coursesRepo.ts:113`) **새 id가 발급**되고 예전 하이라이트·태스크·대화가 통째로 안 보이게 된다.
삭제 확인 문구도 「자료 폴더는 남습니다」만 말하고 나머지는 언급하지 않는다(`CourseDialogs.tsx:290-293`).

**2.13 학기(semester) 개념이 없다 · P1 · L**
`courses` 테이블에 학기/연도 컬럼이 없다(`db/schema.sql`). 2학기째부터 사이드바에
10개, 3학기째 15개가 평면으로 쌓인다. 2.1과 겹쳐서 유일한 정리 수단인 「보관」이
편도라 아무도 못 쓴다.

**2.14 과목 순서를 바꿀 수 없다 · P2 · S**
`sort_order` 컬럼과 `nextSortOrder()`는 있는데(`coursesRepo.ts:147`)
`courses:reorder` 채널이 contract에 없다(`contract.ts:52-98` 전수 확인).
순서가 등록 순으로 영구 고정된다.

**2.15 과목 5개 등록에 다이얼로그 10번 · P2 · S**
`courses:pickFolder`가 `properties: ['openDirectory','createDirectory']`로
**multiSelections가 없다**(`registerHandlers.ts:103`). `multiSelections: true` 한 줄이면
학기 초 세팅이 절반으로 줄어든다.

**2.16 열려 있는 파일이 트리에서 표시되지 않는다 · P2 · S**
`materialsStore`에 선택/활성 파일 상태가 없고(`materialsStore.ts:9-23`),
`materials.css`에 `data-selected` 규칙도 없다. 탭 5개를 열어두면 트리에서 현재 위치를 알 수 없다.

**2.17 심볼릭 링크 자료가 조용히 사라진다 · P2 · S**
`walkDir`이 `isDirectory()`/`isFile()`만 처리하고 나머지는 말없이 건너뛴다(`materialsRepo.ts:95`).
공유 폴더를 심볼릭 링크로 걸어둔 학생은 자료가 왜 안 보이는지 알 수 없다.

**2.18 자료 사이드바 빈 상태가 합니다체 · P2 · S**
`MaterialsSidebar.tsx:182-183` 「과목을 선택하세요」/「선택한 과목의 자료가 여기에 표시됩니다.」
— STYLEGUIDE §7은 앱 본체를 해요체로 못박는다. §7 표에 이 표면의 표준 문구가
아예 없다는 것도 문제다(표를 채우든 문구를 고치든 하나는 해야 한다).
`CourseSidebar.tsx:221`도 §7 표의 둘째 줄을 임의로 바꿔 썼다(§7은 "그대로 재사용할 것"이라고 명시).

---

## 3. PDF

**3.1 하이라이트 메모가 조용히 사라진다 · P0 · S**
`HighlightPopover`의 메모는 `commit()`에서만 저장되고, `commit()`은 blur / ⌘↩ /
저장 버튼 / AI 버튼에서만 불린다(`features/pdf/popovers.tsx:130-134`, `182-195`, `211-221`).
그런데 dismiss 경로 두 개가 **blur 없이 즉시 언마운트**시킨다:
`pointerdown`을 **capture 단계**에서 듣고(`popovers.tsx:36-45`, `:49`가 `true`)
바깥 클릭이면 곧장 `onDismiss()` → `PdfTab.tsx:502`가 textarea를 DOM에서 제거한다.
capture pointerdown은 브라우저가 포커스를 옮기기 **전**이고, 포커스된 엘리먼트가
DOM에서 제거될 때 Chrome은 `blur`를 발생시키지 않는다 → `commit()` 미실행.
Escape(`:46-48`)도 동일.
**증상: 메모를 타이핑하고 본문 아무 데나 클릭 = 전부 소실, 경고 없음.**
강의 중 가장 자주 하는 동작이다. → dismiss 직전에 commit을 부르도록 래핑하거나
draft를 부모로 승격.

**3.2 PDF 내 텍스트 검색이 없다 · P0 · M**
`PdfToolbar.tsx`(1-139) 전체에 있는 건 페이지 점프·축소·배율·확대·레일 토글뿐이다.
`features/pdf/**` 어디에도 find 코드가 없다.
300쪽 교재에서 시험 전에 "가상 메모리" 찾기 = 불가능. 뷰어에서 단일 최다 사용 기능이다.
→ pdf.js `findController` 또는 `usePageTexts` 확장 + 매치 하이라이트.

**3.3 개요(TOC)·썸네일이 없다 · P1 · M**
`pdf.getOutline()`을 부르는 곳이 없다. 대부분의 교재 PDF에 이미 들어 있는 북마크를
통째로 버리고, 학생은 "3장이 몇 쪽부터더라"를 매번 때려 맞춰야 한다.

**3.4 스크롤 프레임마다 페이지 수만큼 `getBoundingClientRect()` · P1 · S**
`PdfTab.tsx:212-221`의 `handleScroll`이 rAF마다 `pageAtViewportCenter()`를 부르고,
그 구현(`useVisiblePages.ts:102-119`)이 등록된 모든 페이지 엘리먼트를 순회한다.
`PdfTab.tsx:450`이 전 페이지 `<section>`을 항상 마운트하므로 300쪽 = **프레임당 300회
강제 레이아웃 읽기**. 교재를 빠르게 넘길 때 스크롤이 끊긴다.
→ offsetTop 캐시 이진 탐색 또는 IntersectionObserver 결과 재사용.

**3.5 대용량 PDF: 64MB 상한 + base64 왕복 + 영어 에러 · P1 · M**
`materialsRepo.ts:50` `MAX_READ_BYTES = 64MB`, 초과 시 영어 `ValidationError`(`:249-251`)가
`Error invoking remote method 'materials:readFile':` 접두어까지 붙은 채 그대로
`ErrorPanel`에 노출된다(`usePdfDocument.ts:18` → `PdfTab.tsx:87-97`).
메모리도 나쁘다 — 파일 전체를 base64 문자열로 만들고(`:257`) 렌더러가 다시
`data:application/pdf;base64,`를 붙여 새 문자열을 만들며(`usePdfDocument.ts:43-44`),
그게 탭 수명 내내 state에 상주한다. 60MB 스캔본 하나에 200MB+.
→ custom protocol 또는 range request 스트리밍. 최소한 에러 문구는 §7 톤 한국어로.

**3.6 스크롤 기억이 세션 한정 · P1 · M**
orca-analysis §M3의 LRU 아이디어는 **구현되어 있다**(`lib/scrollMemory.ts`, 용량 20,
`PdfTab.tsx:202-210` 저장 / `:233-247` 복원, 테스트도 있음). 그러나 모듈 싱글턴일 뿐
DB/IPC로 영속화하는 코드가 없다 — 앱을 끄면 "어제 187쪽"은 사라진다.
복원 정확도도 문제다: `scrollTop × (현재 scrollHeight / 저장 시 scrollHeight)` 비례 환산인데
복원 시점엔 1쪽 aspect만 실측이고 나머지는 추정치(`:51`)라 이후 실제 값이 채워지며 위치가 밀린다.
→ 레이아웃 저장 경로에 얹고, px가 아니라 **페이지 인덱스** 기준으로 복원.

**3.7 없어진 페이지의 하이라이트 = 무반응 유령 항목 · P1 · S**
파일이 교체돼 페이지 수가 줄면 본문은 `numPages`까지만 돌고(`PdfTab.tsx:450`)
레일은 여전히 전부 나열한다(`AnnotationRail.tsx:29-47`은 `numPages`를 모른다).
클릭하면 `elementFor(page)`가 null이라 그냥 `return`(`PdfTab.tsx:357-362`) — 무반응, 무피드백.
`usePageTexts`의 reject도 조용히 삼켜져(`usePageTexts.ts:60-62`) "위치 불확실" 배지조차 안 붙는다.

**3.8 하이라이트 생성 실패가 침묵한다 · P1 · S**
`PdfTab.tsx:303-320` — `create`가 null을 돌려줘도 selection 해제는 그대로 진행된다.
에러는 `annotationsApi.error`에만 담기고 그건 기본 닫힘인 레일에서만 렌더된다
(`AnnotationRail.tsx:131`, `PdfTab.tsx:123`). 형광펜을 그었는데 아무 일도 안 일어나고 이유도 없다.

**3.9 뷰어·주석 흐름을 키보드만으로 쓸 수 없다 · P1 · M**
- selection 캡처가 `document`의 **mouseup만** 듣는다(`PdfTab.tsx:284-295`) → Shift+화살표
  키보드 선택은 `SelectionPopover`를 절대 못 띄운다.
- 기존 하이라이트 열기는 `<section>` onClick + 좌표 히트테스트뿐(`PdfPageView.tsx:90-100`,`125-134`),
  포커스 가능한 요소도 role/tabIndex도 없다.
- 하이라이트 레이어 전체가 `aria-hidden="true"`(`PdfPageView.tsx:148`).
마우스가 없으면 형광펜을 긋지도 그은 걸 열지도 못하고, 스크린리더 사용자는 하이라이트의 존재조차 모른다.

**3.10 팝오버 포커스 관리 부재 · P1 · S**
편집 팝오버(`popovers.tsx:136-143`)는 `role="dialog"`인데 `aria-modal` 없음, 초기 포커스 없음,
트랩 없음, 복원 없음. `SelectionPopover`(`:74-80`)는 `.pdf-content` 최하단에 렌더돼
Tab 순서상 남은 페이지 수백 개 뒤에 놓여 사실상 도달 불가다.

**3.11 PDF 뷰어 단축키가 하나도 없다 · P2 · S**
확대/축소가 ctrl/⌘+휠만(`PdfTab.tsx:188-199`). ⌘+/− 는 `viewMenu` role(`main/menu.ts:56`)이
가져가 **앱 전체 zoom**을 바꾼다 — PDF만 키우려던 학생이 UI 전체를 망가뜨린다.
PageUp/Down/Home/End도 스크롤러에 포커스가 있을 때만 브라우저 기본 동작에 기댄다.
→ `.pdf-scroller`에 `tabIndex={0}` + 키맵, viewMenu zoom 재바인딩.

**3.12 열려 있는 파일이 디스크에서 바뀌어도 반응 없음 · P2 · S**
`usePdfDocument.ts:28-55`는 마운트 시 1회만 읽는다. `materials:changed` 푸시는 있는데
(`registerHandlers.ts:85`) 구독자가 `MaterialsSidebar.tsx:72` 하나뿐이다.
→ PDF 탭에 "파일이 바뀌었어요 [다시 불러오기]" 배너.

**3.13 암호 걸린 PDF에 비밀번호 입력 UI가 없다 · P2 · S**
`<Document>`에 `onPassword`가 없어(`PdfTab.tsx:441-449`) pdf.js `PasswordException`이
"파일이 손상되었을 수 있어요"라는 **틀린 안내**로 떨어진다(`:445`). 출판사 교재 PDF가 여기 해당한다.

**3.14 화면 밖 페이지 289개가 동시에 무한 애니메이션 · P2 · S**
전 페이지가 항상 마운트되고(`PdfTab.tsx:450`) placeholder에 `animation: pdf-pulse 1.6s
infinite alternate`가 걸린다(`pdf.css:205-209`). 게다가 `.pdf-page`마다 `box-shadow`(`:195-203`).
뷰포트 밖 페이지를 "불러오는 중"이라고 부를 근거가 없다(STYLEGUIDE §5 취지 위반).

**3.15 렌더 취소가 없고 캔버스 상한이 없다 · P2 · M**
`useVisiblePages.ts:11` `NEAR_VIEWPORT_MARGIN = '100% 0px 100% 0px'` → 약 3화면분이
상시 캔버스로 유지된다. 배율 상한이 4배(`PdfTab.tsx:47`)라 A4 한 장이 수십 MB가 될 수 있다.
→ 배율 연동 rootMargin + 동시 캔버스 수 캡.

**3.16 레일을 열면 보이는 모든 페이지가 재래스터화된다 · P2 · M**
레일이 `flex: 0 0 var(--rail-right-width)`(`pdf.css:540`)로 스크롤러 폭을 줄이고 →
ResizeObserver → `pageWidth` 변경 → 모든 `<Page width>` 변경 → pdf.js 전체 재렌더.

**3.17 주석 내보내기·스터디 모드가 없다 · P2 · S**
`features/pdf/**`에 export가 없다. 주석은 SQLite에만 있어(`db/schema.sql:37-49`) 앱 밖으로
나갈 길이 없다. "이번 학기 형광펜 전부 한 장으로" 가 안 된다.
→ 레일 헤더에 "마크다운으로 내보내기" → 기존 `notes:create` 재사용. 싸고 효과 크다.

**3.18 주석 레일 빈 상태가 §7 표준형 미달 · P3 · S**
`AnnotationRail.tsx:133-143` — 문장(emblem)은 있으나 "한 줄 사실"이 없고 안내 한 줄뿐이다.
줄바꿈도 하드코딩 `<br/>`(`:140`)이라 레일 폭이 바뀌면 깨진다.

**3.19 pdf.css의 규약 이탈 · P3 · S**
`outline: none` 전역 규칙 덮어쓰기 2곳(`pdf.css:55`, `:449` — §8 위반),
`border-radius: 2px`(`:222` — §4 "임의 px 반지름 금지" 직접 위반),
`width: 3px`(`:726`), `min-width: 3.25rem`(`:106`), `width: 16.5rem`(`:345`),
`height: 1.5rem` 6회 반복(`--control-height` 토큰이 이미 있는데 미사용).
raw 색상값은 없다(§1 준수).

---

## 4. 필기

**4.1 undo/redo가 없다 · P0 · S**
`@milkdown/plugin-history`가 `package.json:22-28`에 없고 `node_modules/@milkdown/`에도
설치돼 있지 않다(`preset-commonmark/lib/` 전체에 "history" 문자열 0건).
`NoteTab.tsx:99`는 `editor.use(commonmark).use(gfm)`만 한다 → **⌘Z 무동작.**
더 나쁜 건 `main/menu.ts:55`가 `role: 'editMenu'`로 ⌘Z를 네이티브 `webContents.undo()`에
묶는다는 것이다. ProseMirror가 제어하는 contenteditable에 네이티브 undo가 걸리면
문서 상태가 깨질 수 있다(**미확인** — 플러그인 부재 자체는 확인됨).
→ `plugin-history` 추가 + Edit 메뉴 undo/redo를 커스텀 항목으로 교체.

**4.2 종료·크래시 시 미저장 필기 유실 · P1 · M**
`NoteTab.tsx:270-276`의 `beforeunload`가 `void flushRef.current()` — 비동기 IPC를
fire-and-forget 한다. `preventDefault()`도 없다. `main/index.ts:55-57`의 `will-quit`은
`closeDatabase()`만 하고 노트 flush를 기다리지 않는다.
⌘Q 직후 마지막 800ms(`SAVE_DELAY_MS`, `:28`) 편집분이 사라진다.

**4.3 충돌 상태에서 탭을 닫으면 그 뒤 입력분이 전부 소실 · P1 · M**
충돌이면 자동저장을 멈추는 건 의도인데(`NoteTab.tsx:291`), 언마운트 flush가 부르는
`flush()`가 `:168`에서 `if (mtimeRef.current === null || (conflictRef.current && !overwrite)) return`으로
**조용히 버린다**. 배너를 무시하고 계속 필기하다 탭을 닫으면 증발한다.
→ 닫기 시 확인 다이얼로그 또는 `.conflict.md` 사이드카 자동 대피.

**4.4 탭 닫을 때 저장 실패가 완전히 침묵한다 · P1 · S**
`NoteTab.tsx:282-283`이 `void flushRef.current()` **직후** `aliveRef.current = false`로 만든다.
이후 `setStatusIfMounted`(`:143-150`)는 전부 no-op이고 catch(`:195-204`)도 UI에 아무것도 안 남긴다.
디스크 꽉 참·권한 오류·폴더 삭제 시 학생은 저장됐다고 믿는다.
→ 실패를 탭 수명과 분리된 앱 레벨 토스트로 승격.

**4.5 「내 버전 유지」가 디스크 버전을 백업 없이 덮어쓴다 · P1 · S**
`NoteTab.tsx:315-322` → `flush(true)` → `notesRepo.write`가 `expectedMtime` 없이
`writeFileSync`(`notesRepo.ts:98-99`). 에이전트·클라우드 동기화·다른 에디터가 쓴 내용이
흔적 없이 사라진다. STYLEGUIDE §8("위험 동작은 2단계")에도 어긋난다 — 확인 없이 바로 실행.
→ 덮어쓰기 전 `.bak` 대피 + `role="alertdialog"` 확인.

**4.6 타이핑 한 글자마다 노트 전체를 직렬화 · P1 · S**
`NoteTab.tsx:86-96` — ProseMirror `Plugin.view.update`가 문서 변경마다
`serializerCtx(view.state.doc)`를 동기 실행한다. 디바운스는 저장에만 걸려 있다.
한 학기치 필기가 쌓이면 키 입력 지연이 체감되고, 한글 IME 조합 단계마다 발생한다.
→ dirty 플래그만 세우고 flush 시점에 직렬화.

**4.7 이미지 붙여넣기·수식·코드 하이라이팅이 없다 · P1 · M**
설치된 milkdown 패키지는 `preset-commonmark`, `preset-gfm`뿐이다.
`plugin-clipboard`(이미지 붙여넣기), `plugin-math`(LaTeX), `plugin-prism`(코드 색), `plugin-slash` 전부 없음.
`note-tab.css:337-345`가 `pre[data-language]::before`로 언어 배지는 그리지만 토큰 색은 없다.
**수식 없는 이공계 필기, 강의 슬라이드 캡처를 붙여넣을 수 없는 필기 앱**이다.
→ 우선순위: `plugin-clipboard` → `plugin-math` → `plugin-prism`.

**4.8 새 필기 이름이 분 단위 타임스탬프 · P2 · S**
`NewTabMenu.tsx:36-39` `defaultNoteTitle`이 `새 필기 2026-08-05 17.00` 형태다.
같은 분에 두 번 만들면 `-2` 접미사가 붙고(시드 데이터 `~/Documents/Bandal/test-course/`에서
실제로 관측됨: 0바이트 노트 1개 + `-2` 1개), 빈 노트가 디스크에 남는다.
자료 트리가 제목 없는 파일로 채워진다.
→ 첫 헤딩/첫 줄로 자동 rename, 빈 노트는 닫을 때 정리.

**4.9 노트 탭 문체가 §7 위반 (합니다체) · P2 · S**
`NoteTab.tsx:198` "디스크의 파일이 편집 중 변경되었습니다.", `:329` "필기를 불러오지 못했습니다.",
`:406` "올바르지 않은 필기 탭입니다." — 워크스페이스인데 합니다체다.
PDF 쪽은 올바르게 해요체라(`PdfTab.tsx:93`, `:445`) 같은 워크스페이스에서 탭마다 말투가 다르다.

**4.10 `--accent-muted`를 장식 면으로 남용 · P2 · S**
`note-tab.css:256`(blockquote 배경), `:322`(모든 인라인 code 배경), `:377`(테이블 헤더 배경).
§3은 액센트를 "상태 강조·활성 표시에만"이라 하고, §2는 "코드 조각"의 자리로 `--bg-raised`를 지정한다.
코드가 많은 필기는 문서 전체가 금색으로 얼룩진다.

**4.11 노트 아웃라인·글자 수·노트 내 검색·PDF 상호 링크 없음 · P3 · M**
`askAi.ts` 외에 PDF↔노트를 잇는 기능이 없다.

---

## 5. AI 튜터

> 런타임 자체는 잘 만들어져 있다 — 프로세스 그룹 킬, seq-gap 재수화, 원자적 턴 커밋,
> 토큰 기반 CSS, 스파이크로 검증한 와이어. 문제는 **오류 가독성 · 권한 범위 · 진행 중 턴의 내구성**에 몰려 있다.

**5.1 Write/Edit가 사전 승인 + 경로 봉쇄 없음 · P0 · M**
`ClaudeCodeAdapter.ts:31-40`이 `Edit`/`Write`를 `CLAUDE_ALLOWED_TOOLS`에 넣고,
`:93-98`이 `--permission-mode acceptEdits --allowedTools Read Glob Grep Edit Write WebSearch WebFetch TodoWrite`로 띄운다.
`file_path`가 `course.folder` 안인지 검사하는 코드가 **어디에도 없고**,
`applyPermissionRequest`(`SessionManager.ts:311-335`)는 allowlist **바깥** 도구에만 실행되므로
`~/.zshrc` 수정은 승인 카드조차 안 뜬다.
(CLI가 자체적으로 cwd를 봉쇄하는지는 **미확인** — 어느 쪽이든 반달에는 자체 방어가 없다.)
학생이 보는 유일한 안전 UI가, 정작 위험한 도구에 대해서는 죽은 코드다.
→ `Edit`/`Write`를 allowlist에서 빼고 `--permission-mode default`로, 자동 허용 전 cwd 봉쇄 검사 추가.

**5.2 사용 한도·인증 만료·오프라인 오류가 화면에 안 뜬다 · P1 · S**
`streamMapper.ts:348-382`의 `mapResult`는 `subtype`/`terminal_reason`/`usage`/`cost`/`duration`만
읽고 `raw['result']`·`raw['is_error']` 텍스트를 버린다. `chatModel.ts:361-391`은
`stopReason === 'interrupted'`만 분기하고 `'error'`·`'max-turns'`는 **아무 표시도 안 한다**.
`agent-events.ts:18`의 `usage-limit` 코드는 타입 선언만 있고 emit하는 곳이 없다.
**구독 기반 제품에서 가장 흔한 실패인 5시간 한도가, 빈 말풍선 하나로 끝난다.**
→ `result.is_error` + 텍스트를 `AgentLimitEvent`/`AgentErrorEvent`로 매핑, `stopReason` 칩 렌더.
곁들여 5.3: 한도 배너는 다음 전송 시 지워진다(`chatModel.ts:486-492`) — 가장 필요한 순간에 사라진다.

**5.3 `--resume` 실패가 과목 채팅을 영구히 막는다 · P1 · S**
`SessionManager.ts:153-155`가 `cliSessionId`가 있으면 항상 넘기고, 이를 지우는 코드가 없다.
트랜스크립트가 삭제됐거나 CLI가 id를 거부하면 자식이 종료 → 치명적 `process-crashed`
(`ClaudeCodeAdapter.ts:273-296`) → status `error`(`SessionManager.ts:298-305`).
다음 `send()`가 **같은 죽은 id로 다시 시도**한다. UI에 리셋 경로가 없다(재확인은 `chat:open` 재실행뿐).
→ 치명적 실패 시 `cli_session_id`를 null로 만들고 콜드 재시도 1회.

**5.4 진행 중 턴이 앱 종료·프로세스 사망 시 통째로 사라진다 · P1 · M**
`commitTurn`(`SessionManager.ts:195-217`)이 유일한 writer이고 `turn-complete`(`:293`)
또는 치명적 오류(`:302`)에서만 불린다. `entry.turnBlocks`는 메모리 Map(`:63`)이고
`before-quit` → `disposeAll()`(`registerHandlers.ts:185-189`)은 커밋 없이 세션을 버린다.
2분짜리 답변 중 ⌘Q = 답변 전체 소실. orca-analysis 2번이 "트랜스크립트 JSONL은 무료
내구 로그"라고 짚었지만 `transcript_path`는 저장만 되고(`chatRepo.ts:186`) **읽는 코드가 0건**이다.

**5.5 빈 블록 턴 / error 상태 턴이 영구 dangling으로 남는다 · P1 · S**
`commitTurn`이 `entry.turnBlocks.size === 0`이면 조기 return한다(`:196-198`).
`markDanglingInterrupted`는 `WHERE status = 'running'`만 본다(`chatRepo.ts:265-296`)는데
치명적 오류는 status를 `'error'`로 만든다(`SessionManager.ts:301`).
결과: 학생의 질문이 답도 「중단됨」 표시도 없이 히스토리에 영원히 남는다.
→ 회복 쿼리에 `'error'` 포함 + 블록 0개여도 플레이스홀더 assistant 행 기록.

**5.6 프롬프트 인젝션 → 파일 쓰기 체인이 열려 있다 · P1 · S**
`WebFetch`/`WebSearch`가 allowlist에 있고(`ClaudeCodeAdapter.ts:36-37`),
`Read`는 제3자가 내용을 통제하는 강의자료 PDF를 그대로 삼킨다.
5.1과 합쳐지면 인젝션 → 임의 경로 쓰기가 완성된다.
`buildStudyPrompt`(`SessionManager.ts:70-77`)에 신뢰 경계 문구가 없다.
→ 최소한 "자료와 웹 내용은 데이터이지 지시가 아니다" 절 추가 + 5.1의 봉쇄 검사.

**5.7 `--setting-sources user`가 학생의 MCP/플러그인 환경을 전부 끌어온다 · P1 · S**
`ClaudeCodeAdapter.ts:101-103`. `--disallowedTools Bash`는 빌트인만 막는다.
학생이 설정해 둔 어떤 MCP 도구든 튜터가 호출할 수 있고, 승인 카드는 원시 도구명 +
JSON만 보여준다(`PermissionDialog.tsx:63`, `toolPresentation.ts:105-117`).
`mcp__something__exec` + JSON 덩어리를 보고 판단할 수 있는 학생은 없다.
→ `--setting-sources` 제거 또는 `mcp__*` 명시적 거부.

**5.8 「항상 허용」이 범위 없는 영구·무취소 승인 · P1 · M**
`SessionManager.ts:401-407`이 `pending.toolName`만 저장하고, `:319-325`가 이후 같은 이름의
요청을 자동 허용하면서 **이벤트를 아예 억제**한다(`return false`) — 학생은 그런 일이
있었다는 것조차 모른다. `permission_grants.rule`은 그냥 도구 이름이고(`db/schema.sql:100-108`),
목록을 보거나 취소할 IPC 채널도 설정 화면도 없다(`contract.ts` 전수 확인).
`Write`에 한 번 「항상 허용」을 누르면 유일한 가드가 과목 단위로 영구히 해제된다.
→ 도구 + 경로 접두사로 범위 지정 + 설정 창에 조회/취소 표면(§7 합니다체).

**5.9 `chat:close`가 렌더러에서 한 번도 안 불린다 → 과목당 CLI 프로세스 누수 · P1 · S**
핸들러(`registerHandlers.ts:204-208`)와 계약(`contract.ts:207`)은 있는데 호출자가 **0건**이다.
게다가 유휴 회수 타이머는 `turn-complete`에서만 무장되므로(`SessionManager.ts:296`)
오류로 끝났거나 턴을 못 마친 세션은 종료 시까지 산다.
`claude` 자식 하나가 온전한 Node 프로세스라 `MAX_WARM_SESSIONS = 3`(+1, 5.10 참조)이면
학생 노트북에서 쉽게 ~1GB RSS다.

**5.10 LRU 축출이 진행 중 세션을 죽이고, 개수가 하나 어긋난다 · P2 · S**
`SessionManager.ts:126-138` — `warm`이 `current`를 제외하므로 실제로는 maxWarm + current = 4개가 산다.
`lastUsedAt`(`send`에서만 갱신, `:362`)로 정렬하고 `entry.info.status`를 보지 않아서,
과목 A에서 긴 답변이 스트리밍되는 중에 B/C/D에 메시지를 보내면 A의 프로세스가 SIGTERM되고
`process-crashed`로 표면화된다.

**5.11 「AI에게 물어보기」가 파일 이름을 빠뜨린다 · P1 · S**
`features/pdf/askAi.ts:20`이 `p.${annotation.page}에서 하이라이트한 부분이야: "…"` 만 만든다.
`annotation.relPath`가 있는데(`shared/types/annotation.ts:30`) 안 넣는다.
에이전트는 문서 없는 페이지 번호만 받아 주변 맥락을 열어볼 수 없다. **한 줄 수정.**

**5.12 히스토리가 300개 tail 고정 · P1 · M**
`chatRepo.ts:20` `HISTORY_TAIL_LIMIT = 300`, `historyTail`(`:231-263`)이 유일한 read path.
orca-analysis 4번은 "300 tail + 위로 스크롤 페이지네이션"을 요구했는데 전반부만 들어왔다.
301번째 이전 메시지는 SQLite에 있는데도 도달 불가.

**5.13 스트리밍 재렌더 + 프레임마다 마크다운 전체 재파싱 · P2 · M**
`MessageList.tsx:114-135`가 전 메시지를 `memo` 없이 매핑하고, 40ms 배치마다
`state.messages` identity가 바뀌어 N개가 전부 재렌더된다. `MarkdownView`는 `text`로
메모되지만 스트리밍 중엔 매 프레임 `text`가 바뀌어 누적 답변 전체를 다시 파싱한다.
`parseInline`(`markdown.ts:121-137`)은 매치마다 남은 문자열에 정규식 4개를 돌려 대략 O(n²)다.
가상화도 없어(`:119-133`) 오래된 과목 채팅을 열면 마크다운 트리 300개를 한 번에 마운트한다.

**5.14 모델 프로브가 죽은 코드, 모델이 해석된 id로 고정된다 · P2 · M**
`probeModels`는 완전히 구현돼 export까지 되는데(`agent/index.ts:13`) 호출자가 없다 —
IPC 채널도 설정 필드도 없다(`shared/types/settings.ts`). 한편 `SessionManager.ts:156-158`이
`system:init`이 해석해 준 모델 id를 계속 재전달해서(`streamMapper.ts:397`) 과목이
`claude-sonnet-4-5-20250929` 같은 값에 영구 고정된다. 그 id가 은퇴하면 재시작마다 실패한다.

**5.15 `transcript_path`가 추측일 뿐 검증도 사용도 안 된다 · P2 · S**
`ClaudeCodeAdapter.ts:207`이 `join(transcriptDirFor(cwd), \`${sessionId}.jsonl\`)`을 무조건 만든다.
`existsSync` 검증이 없고 `launch_config_json`도 쓰기만 하고(`chatRepo.ts:186-188`) 읽지 않는다.
orca 2번의 실제 목적(파일명이 session_id와 다를 수 있음 + 크래시 복구 로그)이 미실현이다.

**5.16 승인 카드의 시각적 위계가 위험을 뒤집는다 · P2 · S**
`chat-blocks.css:288-292`가 「허용」에 `--accent` 채움 primary를, `:294-301`이 「거부」에 `--danger`를 준다.
STYLEGUIDE §3 안티롤 — `--danger`는 "파괴적 확정에만 … 취소 버튼 금지". 거부가 안전한 쪽이다.
거부 사유 입력도 없고 `ClaudeCodeAdapter.ts:379`가 영어 `'User denied this action'`을 하드코딩해 모델에 보낸다.
`chat-blocks.css:321-324`가 「허용함」 배지 텍스트에 `--status-done`을 쓰는 것도 §3 위반이다.

**5.17 복사·다시 답변·메시지 수정·내보내기가 전부 없다 · P2 · M**
`features/chat/**` 전수 확인 — 중지만 있다(`Composer.tsx:118-129`).
메시지별 복사 버튼도, 「다시 답변」도, 보낸 메시지 수정도, 대화 내보내기도 없다.

**5.18 학생 가치 공백 요약**

| 원하는 것 | 상태 |
|---|---|
| 생성 중지 | ✅ |
| 하이라이트 → AI 질문 | ⚠️ 있으나 파일명 누락 (5.11) |
| 스타터 프롬프트 | ✅ (`ChatTab.tsx:32-36`) |
| 답변이 어느 PDF 몇 쪽에서 왔는지 | ❌ 프롬프트에도 UI에도 없음 |
| 지금 보고 있는 페이지를 맥락으로 | ❌ 주석 트리거에만 존재 |
| 강의자료로 요약·퀴즈 만들기 | ⚠️ 자유 텍스트 칩뿐, 구조화된 흐름 없음 |
| 과목별 기억 (CLAUDE.md) | ❌ `buildStudyPrompt`(`SessionManager.ts:70-77`)가 모든 과목에 동일 |
| 300개 이전 대화 보기 | ❌ (5.12) |
| 모델 바꾸기 | ❌ (5.14) |
| 튜터가 뭘 할 수 있는지 보고 취소하기 | ❌ (5.8) |

**5.19 그 외 · P3 · 각 S**
- `/bin/zsh -lic` 하드코딩(`binaryLocator.ts:121`) — 학생의 실제 `$SHELL` 무시,
  인터랙티브 로그인 셸이 프롬프트에서 멈추면 10초 타임아웃(`:15`)을 각각 문다.
- CLI 경로를 설정에서 지정할 수 없다 — `deps.configuredPath`는 지원하는데(`binaryLocator.ts:132`)
  `registerHandlers.ts:171`이 빈 deps로 부르고 `Settings`에 필드가 없다.
- 원시 stderr tail이 학생 화면에 그대로 뜬다(`ClaudeCodeAdapter.ts:285-293` → `ChatTab.tsx:281-296`) —
  영어 스택트레이스와 절대 홈 경로 노출.
- `chat:open`마다 가용성 재프로브 → 매번 `claude auth status --json` 프로세스를 띄운다
  (`SessionManager.ts:352`, 캐시 없음 `:178-201`).
- `--allowedTools`에 도구 8개를 개별 argv로 흘린다(`ClaudeCodeAdapter.ts:97-98`).
  향후 CLI가 콤마 단일 값을 받으면 2~8번째가 `-p` 모드의 위치 인자로 조용히 바뀐다.
  CLI 2.1.222에서만 검증됨(**미확인**). 콤마 조인 권장.
- 테스트 공백: `streamMapper`/`chatModel`/`eventBatcher`/`jsonlStream`/`SessionManager`는
  훌륭하지만 `ClaudeCodeAdapter`(프로세스 그룹 킬·dispose·exit 경로), `binaryLocator`,
  `modelProbe`, `useChatSession`(seq-gap 재수화), 채팅 컴포넌트는 **테스트 0건**이다.

---

## 6. 브라우저

**6.1 UA에 `Electron` 토큰이 그대로 나가 학교 포털에서 차단된다 · P1 · S**
`setUserAgent` / `userAgent` 소스 전체 **0건**.
`docs/university-sites.md` TL;DR 3번이 명시한다: *"UA에서 `Chrome/<버전>` 토큰을 절대 지우지 마라.
연세대 포털·KAIST 수강신청·서강대 SAINT가 미분류 UA를 fail-closed로 막는다.
`Electron/`과 앱 이름만 제거하라."* 이미 조사해 놓은 요구사항이 구현되지 않았다.
학생이 브라우저를 쓸 이유가 학교 포털인데 거기서 막힌다.

**6.2 받은 강의자료가 과목 폴더로 안 간다 · P1 · M**
`will-download` 핸들러 0건 (소스 전체에서 "download"/"다운로드" 문자열 자체가 0건).
Electron 기본 동작으로 `~/Downloads`에 떨어지고, 학생은 Finder를 열어 다시 드래그해야 한다.
**"매주 강의자료 받아서 넣기"가 이 제품의 핵심 동선인데, 브라우저와 자료 트리가 이어져 있지 않다.**
→ `session.on('will-download')` → 현재 과목 폴더로 저장 + 완료 토스트 + 자료 트리 하이라이트.

**6.3 학교 서비스 바로가기가 없다 · P1 · L**
`docs/university-sites.md`는 18개 대학 LMS·포털·도서관 딥링크를 960줄로 조사해 두었지만
소스에 구현 흔적이 **전혀 없다**("university|snu|etl|lms|preset" grep — milkdown preset 오탐뿐).
북마크·홈·최근 방문도 없고, 새 브라우저 탭의 기본 URL은 `https://www.google.com`이다
(`NewTabMenu.tsx:20`). 한국 학생에게 유용한 기본값이 아니다.

**6.4 로드 실패 시 아무것도 안 보인다 · P1 · S**
`did-fail-load`가 `update({ loading: false })`만 한다(`BrowserGuestView.tsx:110`).
오프라인이거나 URL이 틀리면 학생은 설명 없는 빈 영역을 본다.
→ §7 톤 오류 화면 + [다시 시도].

**6.5 파비콘이 CSP에 막혀 항상 안 뜬다 · P2 · S**
`BrowserPanel.tsx:109-110`이 `page-favicon-updated`가 준 원격 http(s) URL을
`<img src>`로 넣는데(`BrowserGuestView.tsx:106-108`), 호스트 렌더러 CSP는
`img-src 'self' data:`다(`src/renderer/index.html:7`). 항상 차단 → `onError` → 지구본 폴백.
기능이 통째로 죽어 있고 CSP 위반 로그만 쌓인다.
→ 메인에서 파비콘을 받아 data URI로 전달하거나, 기능을 제거.

**6.6 브라우저 기본 조작이 없다 · P2 · S**
페이지 내 찾기, 확대/축소, ⌘L(주소창 포커스), ⌘R, 인증서 오류 처리가 전부 없다.
`docs/university-sites.md`가 경고한 국내 학사 시스템의 키보드보안/플러그인 상황을
고려하면 최소한 인증서·차단 상황 안내는 필요하다.

**6.7 잘 되어 있는 것 (회귀시키지 말 것)**
webview 하드닝은 진짜로 잘 돼 있다 — fail-closed `will-attach-webview` +
파티션 allowlist + preload 제거 + `will-navigate`/`will-redirect` 양쪽 가드 +
deny-by-default 권한 + `file:` 서브리소스 차단(`main/features/browser/webviewPolicy.ts`,
`hardenWebviews.ts`). orca-analysis 1번 레시피가 제대로 이식됐다.

---

## 7. 보드

**7.1 마감일 기준 정렬·보기가 없다 · P1 · M**
정렬 키는 `sortOrder → createdAt → id`뿐이고(`boardLogic.ts:24-30`) 컬럼은 상태 3개 고정(`:3-7`).
`dueAt`은 카드 배지 색에만 쓰인다(`boardLogic.ts:50-61`, `BoardPanel.tsx:166-178`).
과제 마감 관리의 본질은 "다음 주에 뭐가 몰렸나"인데 그걸 보려면 3개 컬럼을 눈으로 훑어야 한다.
**데이터는 이미 다 있다** — 마감순 정렬 토글 + "다가오는 마감" 목록만 붙이면 된다.

**7.2 마감 알림이 전혀 없다 · P1 · M**
`Notification` API 미사용(소스 전체 확인 — `aria-label="알림 닫기"` 두 곳뿐).
`now`가 60초마다 갱신되지만 배지 색만 바꾼다(`BoardPanel.tsx:293-296`).
앱을 열어야만 마감을 안다. 마감 관리 도구로서 핵심 부재.

**7.3 태스크 삭제에 네이티브 `window.confirm` · P1 · S**
`BoardPanel.tsx:389`. STYLEGUIDE §8 위반(위험 동작은 컨텍스트 메뉴 danger → `role="alertdialog"`).
과목 삭제는 규약대로 되어 있는데(`CourseDialogs.tsx:282`) 보드만 다르다.
테마도 안 먹고 렌더러를 블로킹하며, `TaskEditorPopover`의 삭제(`:217-225`)는
팝오버 위에 네이티브 다이얼로그를 띄운다.

**7.4 반복 태스크·서브태스크·완료 아카이브가 없다 · P2 · M**
`BoardTask` 필드가 `id/courseId/title/notes/status/dueAt/sortOrder/createdAt/updatedAt`가 전부다
(`boardRepo.ts:59-71`). "매주 화요일 퀴즈"를 15번 손으로 만들어야 한다.
「완료 숨기기」(`BoardPanel.tsx:486-494`)는 숨기기일 뿐이라 Done 컬럼이 학기 내내 무한히 자란다.

**7.5 드래그 이동이 순차 IPC N회 · P2 · M**
`BoardPanel.tsx:373-376`이 `for (…) await invoke('board:updateTask', …)`.
`planTaskMove`가 컬럼 전체를 재번호 매기므로(`boardLogic.ts:115-129`) 20장 컬럼에서
이동 한 번 = 최대 20회 왕복, 트랜잭션 없음. 중간 실패 시 낙관적 UI가 튄다(`:380-383`).
→ `board:reorderTasks` 벌크 채널 + 단일 트랜잭션.

**7.6 `board:listTasks`가 무제한 + `due_at` 인덱스 없음 · P2 · S**
`boardRepo.ts:121-126`에 LIMIT 없음. 보드는 항상 `includeDone: true`로 전량을 가져오고
(`BoardPanel.tsx:277`) 과목 필터는 클라이언트 사이드다(`boardLogic.ts:38-47`).
`schema.sql`의 인덱스는 `idx_board_tasks_course_status`뿐 — 7.1을 구현하면 바로 필요하다.

**7.7 과목이 없어진 태스크는 고아** — §2.12 참조 (`BoardPanel.tsx:161,164`, `TaskEditorPopover.tsx:113,198-200`).

---

## 8. 설정

**8.1 실제로 바꿀 수 있는 게 테마 하나 · P1 · M**
`Settings` 타입은 `theme / agentProvider / dataRoot / locale / onboarding`
(`shared/types/settings.ts:39-49`). UI에서 실제 동작하는 것:
- 테마 — 동작함(낙관적 적용 + 실패 롤백까지 제대로, `SettingsApp.tsx:627-651`)
- 온보딩 다시 보기 — 동작함(`:186-192`)
- 「보관된 과목 표시」 — `useState`(`:545`)라 창 닫으면 리셋
- `dataRoot` — readOnly + 「추후 변경 예정」(`:206-208`)
- `agentProvider` — 「지원 예정」 배지만(`:427`)
- `locale` — 설정 화면에 언어 항목 자체가 없다(`CATEGORIES`, `:24-60`)

학생이 기대할 만한데 없는 것: **폰트 크기, 데이터 폴더 변경, AI 모델 선택,
단축키 편집, 알림, 내보내기/백업, 초기화.**

**8.2 「준비 중」 비활성 토글 2개가 General 패널 절반을 차지한다 · P2 · S**
`SettingsApp.tsx:218-230` 「새 자료를 옆 탭에서 열기」, 「마지막 탭 복원」 — 둘 다
`disabled`, `checked={false}`, 「준비 중」 배지. 첫 방문자가 보는 첫 패널이 작동하지 않는 컨트롤이다.
(참고: 탭 레이아웃은 이미 과목별로 영속화되고 있다 — `db/layoutRepo.ts`. 두 번째 토글은
이름이 실제 동작과 어긋나 있을 가능성이 있다, **미확인**.)

**8.3 설정 저장 실패가 삼켜진다 · P2 · S**
`settingsStore.ts:108-114`가 `writeFileSync` 실패를 `console.error`만 하고
**성공한 것처럼 `next`를 반환하고 broadcast까지 한다**. 화면에는 "변경 사항은 자동으로
저장됩니다"라고 떠 있고(`SettingsApp.tsx:309`) 재시작하면 되돌아간다. 원인을 알 방법이 없다.

**8.4 §7 톤 혼용 · P3 · S**
`SettingsApp.tsx:245` 「준비됐어요 — 메인 창에서 온보딩이 다시 열립니다.」 한 문장에 해요체+합니다체.
나머지 설정 카피는 규약을 잘 지킨다.

**8.5 설정 CSS에 토큰 규율이 느슨하다 · P3 · S**
`settings-app.css:259` `padding: 38px 44px`(4px 스케일 밖),
`settings-panels.css:551` `border-radius: 28px`(§4 임의 px 반지름 금지),
`border-radius: 50%` 3곳(`settings-app.css:485`, `settings-panels.css:170,246` → `--radius-pill`),
`gap: 6px`/`gap: 2px`, `1.2s` 지속시간 2곳(`settings-panels.css:260,387` — §5는 120/200ms 둘뿐).
**위반이 설정 창 CSS에 몰려 있다** — 이 표면만 규율이 다르다.

---

## 9. 성능

**9.1 렌더러가 단일 2.3MB 청크로 통째로 로드된다 · P1 · M**
`src/renderer/src` 전체에서 동적 `import()` / `React.lazy` **0건**.
실제 산출물: `out/renderer/assets/index-*.js` **2,330,495 B** + `index-*.css` **163,304 B**.
보드만 열어보려는 학생도 Milkdown·dockview·pdfjs·react-pdf를 전부 파싱한다.
→ 탭 종류별 `React.lazy` 분할(pdf / note / browser / chat), CSS도 따라 분리.
(콜드 스타트 실측은 이 환경에서 앱을 못 띄워 **미확인**.)

**9.2 dmg 148MB — 앱 코드는 4MB인데 node_modules 150MB를 함께 배포한다 · P1 · S**
`app.asar` 헤더를 직접 파싱한 결과:

| | 크기 |
|---|---|
| `out/**` (실제 앱 코드) | **4.0 MB** |
| `node_modules/**` | **150.6 MB** (최상위 176개 패키지) |

상위: `pdfjs-dist` 34.9MB, `better-sqlite3` 21.0MB, **`canvas` 18.3MB(테스트 전용 devDependency)**,
`dockview-core` 13.7MB, `dockview` 13.6MB, `@milkdown` 6.8MB, **`@vue` 6.3MB + `vue` 2.4MB**,
`@codemirror` 4.7MB, `katex` 3.8MB, **`@babel` 3.8MB**.
렌더러 의존성은 이미 vite가 번들에 넣었으므로 **실제로 배포가 필요한 건
`better-sqlite3`와 `chokidar`뿐**이다.
→ `electron-builder.yml`의 `files`에 `'!node_modules/**'` + 필요한 것만 화이트리스트.
dmg가 ~20MB로 줄고, 나중에 자동 업데이트를 붙일 때 델타 비용이 한 자릿수로 떨어진다.

**9.3 메인 프로세스 동기 fs 작업 다수 · P1 · M**
§2.2(walkDir), §2.7(`courses:list`의 과목별 statSync), §2.8(검색마다 인덱스 재구축),
`copyFileSync` 임포트 루프(`materialsRepo.ts:232`), 최대 64MB `readFileSync` + base64(`:50,257`).
전부 메인에서 동기라 하나가 느려지면 앱 전체가 멈춘다.

**9.4 CLI 자식 프로세스 누수** — §5.9, §5.10 참조. 과목당 Node 프로세스 하나가 종료 시까지 산다.

**9.5 채팅 스트리밍 재렌더 · 마크다운 O(n²) 재파싱** — §5.13 참조.

**9.6 PDF 스크롤 강제 레이아웃 · 무한 애니메이션 300개 · 캔버스 상한 없음** — §3.4, §3.14, §3.15 참조.

**9.7 자료 트리 가상화 없음** — §2.10 참조.

---

## 10. 접근성

> 대비 수치는 테마 토큰의 oklch 값을 sRGB → WCAG 상대휘도로 직접 계산한 것이다(추정 아님).
> 나머지는 코드 정독 근거이며, 실제 스크린리더/키보드 주행 검증은 **미확인**이다.

### 10.1 키보드만으로 못 하는 것

**10.1.1 자료 트리·검색 결과를 키보드로 열 수 없다 · P0 · S**
`MaterialTree.tsx:67-71` — 파일은 `onDoubleClick` 전용이고 `onClick`(`:64-66`)은 폴더 토글만 한다.
검색 결과 행(`:145`)은 아예 `onClick`이 없다. 오른쪽 사이드바의 **주 동작이 마우스 전용**이다.
(§2.11과 같은 항목 — a11y와 기본 사용성 양쪽에서 걸린다.)

**10.1.2 보드 카드의 컬럼 내 순서를 키보드로 못 바꾼다 · P1 · M**
드래그가 기본이고(`BoardPanel.tsx:141-149`, `:537-546`, `:590-614`),
키보드 대안인 Shift+F10 컨텍스트 메뉴는 이동 항목이 항상 `beforeTaskId: null`을 넘긴다(`:674`).
즉 **컬럼은 바꿀 수 있어도 컬럼 안 위치는 영원히 못 바꾼다.**
→ 포커스된 카드에 ⌥↑/⌥↓.

**10.1.3 PDF 하이라이트를 키보드로 열 수도 고칠 수도 없다 · P1 · M**
하이라이트 레이어 전체가 `aria-hidden="true"`(`PdfPageView.tsx:148`)이고
히트테스트가 `<section>`의 `onClick`/`onMouseMove`(`:131-133`)라 탭 순서에 없다.
유일한 대안 표면인 `AnnotationRail`은 **점프**(`:64-68`)와 **AI 질문**(`:88-97`)만 제공하고
색 변경·메모·삭제는 마우스로만 열리는 `HighlightPopover`에만 있다.
→ 레일 행에 편집/삭제 어포던스 추가.

**10.1.4 `SelectionPopover`가 포커스를 못 받는다 · P2 · S**
`popovers.tsx:67-95`에 `focus()` 호출이 없다. Shift+화살표로 선택한 키보드 사용자는
어딘가 떠 있는 툴바를 향해 맹목적으로 Tab을 눌러야 한다.

**10.1.5 PDF 스크롤러가 키보드 스크롤 가능한지 미확인 · P2**
`PdfTab.tsx:432-436`의 `.pdf-scroller`는 `tabIndex={0}`이 없는 평범한 `<div>`다.
Chromium의 keyboard-focusable-scrollers 휴리스틱에 걸리면 동작하지만 이 Electron 빌드에서는 **실행 확인 필요**.

### 10.2 다이얼로그 · 팝오버 · 메뉴

| 표면 | 위치 | role | aria-modal | ESC | 초기 포커스 | 트랩 | 복원 |
|---|---|---|---|---|---|---|---|
| `CourseFormDialog` | `CourseDialogs.tsx:133` | dialog | ✅ | ✅ | ✅ | ✅ | ❌ |
| `DeleteCourseDialog` | `CourseDialogs.tsx:282` | **alertdialog** | ✅ | ✅ | ✅ | ✅ | ❌ |
| `QuickFileSearch` | `QuickFileSearch.tsx:127` | dialog | ✅ | ✅ | ✅ | ❌ | ❌ |
| `NewTabMenu` | `NewTabMenu.tsx:193` | dialog | ❌ | 일부¹ | ✅ | ❌ | ❌ |
| `OnboardingOverlay` | `OnboardingOverlay.tsx:309` | dialog | ✅ | ✅ | ❌ | ❌ | ❌ |
| `BoardOverlay` | `BoardPanel.tsx:757` | dialog | ✅ | ✅ | ❌ | ❌ | ❌ |
| `TaskEditorPopover` | `TaskEditorPopover.tsx:120` | dialog | `"false"` | ✅ | ✅ | ❌ | ❌ |
| `HighlightPopover` | `popovers.tsx:140` | dialog | ❌ | ✅ | ❌ | ❌ | ❌ |
| `PermissionDialog` | `PermissionDialog.tsx:57` | **group** | — | ❌ | ❌ | — | — |
| 보드 컨텍스트 메뉴 | `BoardPanel.tsx:660` | menu | — | ✅ | ✅ | ❌ | ❌ |

¹ `NewTabMenu.tsx:209`는 **입력에서만** ESC를 처리한다 — 포커스가 옵션 버튼으로 넘어가면 ESC가 죽는다.

**10.2.1 포커스 복원이 12개 표면 전부에 없다 · P1 · S**
`document.activeElement`를 저장했다 복원하는 코드가 한 군데도 없다.
다이얼로그를 닫을 때마다 포커스가 `<body>`로 떨어져 앱 맨 위부터 Tab을 다시 시작해야 한다.
→ 초기 포커스 + 복원을 묶은 공용 `useDialogFocus(open)` 훅 하나.

**10.2.2 `aria-modal="true"`인데 포커스 트랩이 없다 · P1 · S**
`QuickFileSearch`, `OnboardingOverlay`, `BoardOverlay`.
보조기술에는 "뒤는 비활성"이라고 말해 놓고 Tab은 뒤로 걸어 들어간다 — 속성을 안 붙인 것보다 나쁘다.
`CourseDialogs.tsx:43-59`에 `keepFocusInside` 헬퍼가 이미 있으니 끌어올려 재사용하면 된다
(단 셀렉터가 `button:not([disabled]), input:not([disabled])`뿐이라 `select`/`textarea`/`a`를 놓친다 — `TaskEditorPopover`에 필요).

**10.2.3 `role="menu"`에 menuitem이 아닌 자식 + 화살표 키 없음 · P2 · S**
`BoardPanel.tsx:664-665`(`<p>`, `<span>`), `:681`(구분선), `CourseSidebar.tsx:346`, `:376`.
세 메뉴 모두 roving tabindex/화살표 이동이 없어 Tab 전용이다.

**10.2.4 `TaskEditorPopover`가 `aria-modal="false"`인데 모달처럼 동작한다 · P2 · S**
`:121` vs 바깥 pointerdown 닫기(`:57-59`). Tab이 뒤 보드로 빠져나간다.

### 10.3 ARIA

**10.3.1 role 없는 요소의 `aria-label`이 통째로 무시된다 · P1 · S**
`<div>`/`<span>`에 `aria-label`만 붙은 곳 8개 — `BoardPanel.tsx:453`(과목 필터), `:552`, `:567`,
`CourseSidebar.tsx:211`, `MaterialsSidebar.tsx:204`, `OnboardingOverlay.tsx:314`,
`SettingsApp.tsx:200`, `AppShell.tsx:81`(브랜드 "반달").
이름이 보조기술에 도달하지 않는다. → 상황에 맞게 `role="group"`/`"status"`/`"img"` 추가.

**10.3.2 옴니박스 combobox 패턴 미완성 · P1 · S**
`QuickFileSearch.tsx:133-162`, `NewTabMenu.tsx:198-223` — 포커스는 `<input>`에 머문 채
화살표로 `role="option"` 버튼의 `aria-selected`만 옮긴다. 입력에
`role="combobox" aria-expanded aria-controls aria-activedescendant`가 없어
**스크린리더 사용자는 결과를 훑어도 아무 소리도 못 듣는다.**

**10.3.3 `role="radiogroup"`에 화살표 이동이 없다 · P1 · S**
`SettingsApp.tsx:281-289` — `role="radio"` 3개가 전부 개별 탭 스톱이다.
ARIA APG는 단일 탭 스톱 + 화살표 선택을 요구한다.

**10.3.4 라이브 리전이 내용과 동시에 생성된다 · P1 · S**
`toast.tsx:57`이 비었을 때 `null`을 반환하고, 토스트가 **이미 들어 있는 채로**
`role="status" aria-live="polite"` 컨테이너를 마운트한다(`:59-71`).
없다가 생긴 리전은 대부분의 스크린리더가 읽지 않는다. `ChatTab.tsx:275`, `:281-283`도 동일.
→ 빈 라이브 리전을 항상 렌더.

**10.3.5 `role="tree"` 구조가 어긋난다 · P2 · M**
`MaterialTree.tsx:54`가 `<li>`에 `role="treeitem"`을 주는데 포커스 가능한 건 안쪽 `<button>`(`:58`)이다.
treeitem 자체가 포커스 가능해야 한다. `aria-selected`·roving tabindex·화살표 이동도 없다.
ARIA를 선언했으면 상호작용 계약도 따라와야 한다(§2.11과 동일 뿌리).

**10.3.6 워크스페이스 탭에 탭 시맨틱이 없다 · P2 · M**
`WorkspaceHost.tsx:50-77`의 `WorkspaceTab`은 role/aria-selected/aria-controls 없는 `<div>`다.
dockview의 `.dv-tab`이 무엇을 붙이는지는 **미확인**이지만, 반달 자체 코드가 기여하는 건 없다.

**10.3.7 그 외 · P2~P3 · 각 S**
- `BoardPanel.tsx:134-140` — `<article role="button">` 안에 `<h4>`. button role이 자식 구조를 평탄화해 제목이 헤딩 트리에서 사라진다.
- `MessageList.tsx:120` `role="log"`은 맞지만 스트리밍 중 `aria-busy="true"`가 없어 토큰 청크마다 낭독된다(`data-streaming`은 CSS 훅일 뿐, `:75`).
- `PdfPageView.tsx:125-129` — 페이지마다 `<section aria-label="n 페이지">` → 300쪽이면 **region 랜드마크 300개**. `role="group"`으로.
- 툴팁 전용 정보: `AnnotationRail.tsx:83`, `popovers.tsx:176`, `NoteTab.tsx:347`, `MaterialsSidebar.tsx:189`가 실질 정보를 `title=`에만 담는다.
- 탭이 하나라도 열리면 메인 창에 `<h1>`이 사라진다(유일한 h1이 워터마크, `WorkspaceHost.tsx:92/109`). 스킵 링크도 없다.
- **잘 된 것:** 랜드마크 구조(`AppShell.tsx:67/102`, `CourseSidebar.tsx:157`, `MaterialsSidebar.tsx:105`, `AnnotationRail.tsx:118`),
  `role="switch"`+`aria-checked`, `aria-pressed`/`aria-current`/`aria-expanded`/`aria-busy` 사용,
  모든 오류 표면의 `role="alert"`, 마감일 `.sr-only` 텍스트(`BoardPanel.tsx:170-176`),
  아이콘 단독 버튼 라벨링 — 거의 전부 되어 있다.

### 10.4 대비 (실측)

**다크 네이비**

| 조합 | 비율 | 판정 |
|---|---|---|
| text-primary / bg-app | 15.00 | AA |
| text-secondary / bg-app | 8.25 | AA |
| **text-muted / bg-app** | **4.09** | **미달** |
| **text-muted / bg-surface** | **3.77** | **미달** |
| **text-muted / bg-raised** | **3.35** | **미달** |
| accent / bg-app · danger / bg-app | 11.94 · 7.21 | AA |
| primary 버튼 라벨 · danger 버튼 라벨 | 11.94 · 5.90 | AA |
| `--course-*` 6색 · `--status-*` 3색 / bg-app | 7.41~11.94 · 5.22~9.63 | OK |
| **`--accent-muted` focus glow / bg-surface** | **1.43** | 사실상 안 보임 |

**라이트**

| 조합 | 비율 | 판정 |
|---|---|---|
| text-primary / bg-app · text-secondary / bg-app | 14.70 · 6.84 | AA |
| **text-muted / bg-app · bg-surface** | **3.62 · 3.79** | **미달** |
| **accent를 텍스트로 / bg-app · bg-surface** | **3.40 · 3.56** | **미달** (`app-shell.css:265,380`, `settings-app.css:268`) |
| **primary 버튼 라벨 (bg-app on accent)** | **3.40** | **미달** — 13px/600은 large text가 아니다 |
| danger / bg-app · danger 버튼 라벨 | 5.06 · 5.52 | AA |
| `--course-*` · `--status-*` | 3.40~4.69 · 3.69~4.45 | OK |
| **`--highlight-*` 스와치 / bg-overlay** | **1.42~1.65** | **미달** (1.4.11은 3.0 요구) |

**10.4.1 `--text-muted`가 두 테마 모두 AA 미달 · P1 · S**
85곳 이상에서 쓰인다 — eyebrow, 힌트, 메타데이터, `.empty-state__hint`,
`.setting-row__description`, 검색 placeholder(`settings-panels.css`와 `pdf.css`에서만 각 12곳).
다크는 `oklch(64% 0.026 254)`(→ ~5.4), 라이트는 `oklch(50% 0.02 80)`(→ ~5.5) 정도로 올리면 된다.
**토큰 한 줄씩, 85개 호출부가 한 번에 낫는다.**

**10.4.2 라이트 테마 `--accent`가 텍스트·버튼 라벨로 AA 미달 · P1 · S**
`oklch(52% 0.12 75)` 정도로 어둡게 하거나(→ ~5.0), primary 버튼에
`--bg-app` 재사용 대신 전용 `--on-accent` 토큰을 주는 것.

**10.4.3 하이라이트 스와치가 라이트 테마 팝오버에서 안 보인다 · P2 · S**
`pdf.css:363`이 `--border-strong` 링을 주지만 그 자체가 1.52다.

**10.4.4 `--accent-muted` focus glow가 아무 기여도 없다 · P2 · S**
1.16~1.43. `app-shell.css:175`, `courses.css:360`, `workspace.css:370`,
`pdf.css:64/395/459`, `browser.css:123` — 옆에 있는 `border-color: accent`가 일을 다 하고 있다.
빼거나 `--accent`를 더 진한 알파로.

**비-findings:** `.pdf-highlight`는 `mix-blend-mode: multiply; opacity: 0.42`(`pdf.css:223-224`)라
어떤 하이라이트 색 아래에서도 PDF 본문 검정 글씨가 읽힌다. 옳게 설계됐다.

### 10.5 포커스 · 선택 · 히트 타깃

**10.5.1 ⌘P 검색 입력에 포커스 표시가 아예 없다 · P1 · S**
`app/quick-search.css:51`이 전역 outline을 죽이는데 `.quick-search__field`(`:29-37`)에
`:focus-within` 규칙이 없다. WCAG 2.4.7 명백한 실패이자 §8 위반.
(다른 `outline: none` 4곳 — `workspace.css:384`, `chat-blocks.css:393`, `browser.css:149`,
`courses.css:351` — 은 전부 `:focus-within`/`:focus-visible` 대체를 갖추고 있다.)

**10.5.2 `<body>`의 `user-select: none` 때문에 오류 메시지를 복사할 수 없다 · P1 · S**
`base.css:25`. 옵트인이 컴포저·에디터·채팅·PDF 인용에만 있어서
**보드 태스크 제목/메모, 과목 이름, 파일 경로, 토스트, 모든 오류 문자열이 선택 불가**다.
오류를 검색해 보려는 학생이 손으로 옮겨 적어야 한다.

**10.5.3 24px 미만 타깃 (WCAG 2.2 SC 2.5.8) · P1 · S**
- `onboarding.css:44-46` — 온보딩 진행 점이 **8×8px**, 간격 8px(중심 간 16px)로 예외 기준(24px)도 못 넘긴다.
  실제 내비게이션 버튼이다(`OnboardingOverlay.tsx:316-328`). 명백한 실패.
- `workspace.css:127-128` — 탭 닫기 버튼 **20×20px**이고 클릭 가능한 탭 제목에 바로 붙어 있다.
  게다가 hover/focus 전까지 `opacity: 0`(`:131`, `:140-142`)이라 발견성도 낮다.
- `pdf.css:361-362`의 20×20 스와치는 8px 간격(중심 간 28px)이라 **예외로 통과**한다. 문제 아님.

**10.5.4 전체 화면 `<button>` 백드롭이 탭 순서에서 다이얼로그보다 앞선다 · P2 · S**
`BoardPanel.tsx:751-756`.

### 10.6 prefers-reduced-motion

`base.css:109-116`이 전역에서 `animation-duration`/`transition-duration`을 `0.01ms !important`로
묶고, **두 엔트리 모두 base.css를 import한다**(`main.tsx:7`, `settings-main.tsx:7`) — 설정 창까지 커버된다.
다만 STYLEGUIDE §5의 "개별 컴포넌트에서 신경 쓸 필요 없다"는 주장은 아직 사실이 아니다:

**10.6.1 `animation-iteration-count`를 리셋하지 않는다 · P2 · S**
무한 루프 14개가 "0.01ms짜리 무한 애니메이션"으로 살아남는다 —
`chat.css:27/497/546/559`, `chat-blocks.css:47/204/439/457`, `pdf.css:208/278`,
`board.css:437`, `courses.css:138`, `note-tab.css:78`, `materials.css:165`.
세 파일이 이를 눈치채고 각자 국소 패치를 했다(`settings-panels.css:625-631`,
`browser.css:199-204`, `chat-blocks.css:310`) — 정확히 §5가 없어야 한다고 말한 그 걱정이다.
→ 전역 블록에 `animation-iteration-count: 1 !important` + `scroll-behavior: auto !important` 추가하고 국소 패치 3개 삭제.

**10.6.2 CSS를 벗어난 애니메이션 하나 · P2 · S**
`PdfTab.tsx:372` — 레일 점프마다 `scroller.scrollTo({ behavior: 'smooth' })`.
JS 구동이라 미디어 쿼리가 못 잡는다. `matchMedia`로 게이트.

**10.6.3 webview 게스트는 원리상 도달 불가 · 문서화 대상**
게스트 문서에는 렌더러 CSS·테마·reduced-motion이 전달되지 않는다. 고칠 게 아니라 적어둘 것.

### 10.7 STYLEGUIDE 자체를 고쳐야 하는 부분

**10.7.1 §5 "transform/opacity만 애니메이션한다"를 코드 100%가 어긴다 · P2 · S(문서 수정)**
`background`/`color`/`border-color`/`box-shadow` 전환이 25곳쯤 있다
(`board.css`, `chat.css`, `chat-blocks.css`, `browser.css`, `pdf.css`, `note-tab.css`, `settings-*.css`).
전부 페인트 전용이고 hover 피드백으로는 **올바른 선택**이다. 규범 문서와 코드가 전면 불일치하니
둘 중 하나를 고쳐야 한다 — 권장: §5를 "이동은 transform/opacity, 상태 피드백은 페인트 속성 허용,
**레이아웃 속성은 절대 금지**"로 개정.

**10.7.2 루프 지속시간 토큰이 없어서 10개 파일이 각자 발명한다 · P2 · S**
`1.6s`, `1.4s ease-in-out`, `1.2s`, `0.8s linear`, `1.8s`… §5는 `--dur-fast`/`--dur-base` 둘뿐이라고
못박았는데 "숨쉬는 달"·"점 pulse"를 그 안에 담을 수 없다.
→ `--dur-loop`, `--ease-loop` 토큰 추가 후 치환. (`note-tab.css:78`은 `calc(var(--dur-base) * 4)`로 옳게 우회한 사례.)

**10.7.3 §7의 "행동 버튼 하나" 규칙 · P3 · S(문서 수정)**
`CourseSidebar.tsx:223-237`은 primary 버튼 + 텍스트 링크 조합인데, 앱에서 **위계가 가장 잘 잡힌 곳**이고
동시에 유일하게 이 규칙을 어긴 곳이다. 규칙 쪽을 고치는 게 맞다.

### 10.8 디자인 일관성 — "기본값처럼 보이는" 지점

**10.8.1 빈 상태 문장(emblem)이 5가지로 갈린다 · P1 · S**
§6은 반달 마크가 정체성이고 비트맵/일러스트 금지라고 한다. 실제로는:

| 표면 | emblem |
|---|---|
| `CourseSidebar.tsx:218`, `WorkspaceHost.tsx:90/107`, `ChatTab.tsx:147`, `BoardPanel.tsx:519` | CSS 반달 ✅ |
| `MaterialsSidebar.tsx:180/187/220` | **Lucide 폴더 아이콘** ×3 ❌ |
| `AnnotationRail.tsx:135` | **Lucide 연필 아이콘** ❌ |
| `BoardPanel.tsx:575` | 문자 `—` |
| `SettingsApp.tsx:695/752` | 문자 `◐` ❌ (메인 창의 `.brand-half-moon`은 제대로 된 CSS 그러데이션 원인데) |
| `QuickFileSearch.tsx:182`, `NewTabMenu.tsx:227`, `MaterialsSidebar.tsx:212`, `CourseSidebar.tsx:241` | 없음 |

→ emblem + 사실 + 안내 + 액션 하나를 소유하는 `<EmptyState>` 컴포넌트 하나로 통일.

**10.8.2 설정 창이 사실상 다른 제품이다 · P1 · M**
- **원시 px 약 55개** — 나머지 feature CSS 전부를 합친 게 ~15개(전부 정당한 1~3px 보더/인디케이터)인데
  설정 두 파일에 55개가 몰려 있다. 대표: `settings-app.css:15`(`0 var(--space-5) 0 84px`),
  `:259`(`38px 44px var(--space-7)` — 한 선언에 토큰과 매직넘버 혼용), `:3`(타이틀바 `52px` —
  메인 창은 `--chrome-height` 44px), `settings-panels.css:551`(`border-radius: 28px`), `:547`(`font-size: 62px`).
- 폰트 웨이트 `620/720/740`, letter-spacing `0.09em`/`-0.025em` — `tokens.css`에 웨이트 스케일이 없다.
- 아이콘 크기를 숫자로 넘긴다: `size={17}`(`SettingsApp.tsx:205,703,748`), `16`, `14` — `--icon-size` 토큰 미사용.
- 버튼 프리미티브가 다르다: `secondary-button`/`theme-choice`/`toggle` vs 앱의 `.button--primary/secondary/danger`.
- 스크롤바가 두 시스템이다: `scrollbar-width: thin`(`settings-app.css:252-253`) vs `::-webkit-scrollbar`(`base.css:65-85`).
- `:active` 프레스 피드백이 **0개**다(앱 본체는 거의 모든 곳에 있다).
- `.sr-only`(`base.css:87`)와 `.visually-hidden`(`settings-panels.css:584`)이 중복 정의.

**10.8.3 `:active`가 빠진 표면 · P2 · S**
`settings-app.css`(hover 5, active **0**), `settings-panels.css`(hover 2, focus **0**, active **0**),
`boardPopovers.css`(hover 7, focus 4, active **0**), `note-tab.css`(hover 1, focus **0**, active **0**).

**10.8.4 위험 동작 2단계 규칙 미준수 3곳 · P1 · S~M**
`BoardPanel.tsx:389` 네이티브 `window.confirm`, `TaskEditorPopover.tsx:217-225` 확인 없이 즉시 삭제,
`popovers.tsx:159-167` 하이라이트 삭제 즉시 실행(undo 없음).
`CourseDialogs.tsx:282`의 `DeleteCourseDialog`가 정답 구현이니 재사용하면 된다.

**10.8.5 비활성 상태가 설계되지 않았다 · P2 · S**
명시적 `:disabled` 규칙이 6개뿐이고 나머지는 `base.css:59-62`의 일괄 `opacity: 0.5`를 상속한다.
계산해 보면 비활성 `.button--primary` 라벨이 다크 **2.14:1**, 라이트 **1.32:1** — 사실상 안 보인다.
비활성 컨트롤은 WCAG 예외라 위반은 아니지만, §10 체크리스트의 "설계됐는가"에는 답하지 못한다.

**10.8.6 보드가 가장 덜 다듬어진 표면 · P2 · M**
네이티브 confirm(`:389`), 드래그 그립이 문자 `⋮⋮`(`:151-153`), 빈 컬럼 emblem이 `—`(`:575`),
마감 시계가 문자 `◷`(`:168`), 제로 상태에 액션 버튼 없음.
앱의 나머지가 아이콘 세트를 쓰는데 여기만 원시 글리프 4개다.

**10.8.7 자료 트리에 위계가 없다 · P2 · S**
`MaterialTree.tsx:80-84` — 폴더와 파일이 같은 타입 램프, 같은 행 높이, 같은 굵기다.
깊이는 `--tree-depth` 들여쓰기로만 표현된다. 기본 파일 트리처럼 읽힌다.

### 10.9 한국어 문체 (§7) — 전체 스윕 결과

**앱 본체에 합니다체 · P1 · S**
`MaterialsSidebar.tsx:183`, `PlaceholderPanel.tsx:35`, `CourseDialogs.tsx:291-292`,
`NoteTab.tsx:198`, `:329`, `:406`.

**§7 표준 문구 준수도** — 표의 10행 중 **9행이 글자 단위로 일치**한다
(`CourseSidebar.tsx:241/243`, `WorkspaceHost.tsx:92/94`, `MaterialsSidebar.tsx:212/214`, `:223/225`,
`QuickFileSearch.tsx:183`, `NewTabMenu.tsx:227`, `ChatTab.tsx:150/152`+칩 3개, `BoardPanel.tsx:37-39/521-522`).
어긋난 건 `CourseSidebar.tsx:221` 한 줄뿐이다.

**문체가 규칙이 아니라 기능별로 갈린다 · P2 · S**
PDF·폴더 계열은 해요체(`PdfTab.tsx:93/445`, `usePdfDocument.ts:19/38`, `useAnnotations.ts:28`,
`folderMessages.ts:9-11`, `coursesStore.ts:179`), 보드·과목·노트·자료는 합니다체다.
최악의 사례: 같은 카드 안에서 `ChatTab.tsx:242` 「채팅을 열지 못했어요」 바로 아래에
`useChatSession.ts:45` 「채팅을 여는 중 문제가 발생했습니다.」가 온다.
`주세요` 띄어쓰기도 갈린다(띄움: `Composer.tsx:154`, `PreflightBanners.tsx:29`, `QuickFileSearch.tsx:137` /
붙임: `ChatTab.tsx:107/133`, `OnboardingOverlay.tsx:99/230/255`, `CourseDialogs.tsx:107`, `folderMessages.ts:9-11`).
토스트 하나의 채널에 세 가지 문체가 섞이고 `${n}개 가져옴`/`${n}개 실패` 같은 파편도 있다(`importDrop.ts:36/41`).

**영어 오류 문자열이 학생 화면에 그대로 도달한다 · P1 · M** (§11.7과 같은 항목)
`db/errors.ts:11/18/25/32`(`[path-traversal] "…" escapes the course folder`),
`notesRepo.ts:39/46/116`, `materialsRepo.ts:122/214/223/229`, `boardRepo.ts:42/54/139/180`,
`coursesRepo.ts:144/203/312`, `ClaudeCodeAdapter.ts:248/267/281/290`(원시 영어 stderr 10줄까지 붙임).
표시 지점: `MaterialsSidebar.tsx:164`, `CourseSidebar.tsx:202`, `BoardPanel.tsx:510`,
`NoteTab.tsx:330`, `ChatTab.tsx:245/286`, `TaskEditorPopover.tsx:92/106`, `CourseDialogs.tsx:40`, `importDrop.ts:45`.
한국어 폴백은 준비돼 있으나 `error instanceof Error`가 항상 참이라 **정상 경로에서 절대 안 쓰인다.**

**빈/로딩/오류 3종 중 빠진 것 · P1~P2 · M**

| 표면 | 없는 것 | 근거 |
|---|---|---|
| ⌘P 검색 | **오류** | `QuickFileSearch.tsx:93-95`가 rejection을 삼키고 "0건" 문구를 띄운다 — UI가 거짓말을 한다 |
| "+" 새 탭 메뉴 | 오류 + 로딩 | `NewTabMenu.tsx:107-109` — 필기 생성 실패가 `console.error`뿐 |
| 브라우저 | **오류** | `BrowserGuestView.tsx:110` — `features/browser/**` 전체에 실패 페이지 한국어 문구 0건 |
| PDF 하이라이트 레일 | 로딩 | `useAnnotations.ts:119`에 loading 플래그가 없어 로딩 중에도 빈 상태를 보여준다 |
| 프리플라이트 배너 | 오류 | `useAgentPreflight.ts:78`이 실패 시 `[]` → `PreflightBanners.tsx:50`이 아무것도 안 그린다 |
| 설정 › 일반 | 로딩 + 오류 | `SettingsApp.tsx:606`이 `settings:get` 실패를 `themeError`로 보내는데 그건 Appearance 패널에서만 렌더된다 |
| PDF 탭 오류 | 다음 행동 | `PdfTab.tsx:87-97`에 재시도 버튼 없음(§7:102 위반). `NoteTab.tsx:331-333`은 제대로 되어 있다 |

**규약을 지킨 것:** 이모지 0건(정규식 확인), 느낌표 0건, 영어 대문자 eyebrow는 §4가 허용한 패턴.

---

## 11. 플랫폼 · 배포

**11.1 배포본이 adhoc 서명뿐 — 학생이 열 수 없다 · P0 · M**
`release/mac-arm64/Bandal.app` 실측:
```
Identifier=Electron
CodeDirectory flags=0x20002(adhoc,linker-signed)
Signature=adhoc          TeamIdentifier=not set
Sealed Resources=none
$ spctl -a -vvv → "code has no resources but signature indicates they must be present"
```
`electron-builder.yml`이 `identity: null` + `hardenedRuntime: true`다(서명 없는 하드닝은
무의미하고 오히려 실패 원인이 된다). 노터라이즈 설정도 없다.
인터넷에서 dmg를 받은 학생은 quarantine 속성 때문에 Gatekeeper에 막혀
"손상되었기 때문에 열 수 없습니다"를 본다. 우회하려면 우클릭→열기나 `xattr -cr`인데,
그걸 안내하는 순간 제품 신뢰도가 무너진다. `Identifier=Electron`인 것도 문제다.
→ Developer ID 인증서 + notarytool. 배포 계획이 있다면 이게 실질적 1순위다.

**11.2 창 크기·위치를 기억하지 않는다 · P2 · S**
`main/windows/mainWindow.ts:25-27`이 매번 1280×800 고정. `getBounds`/`setBounds` 소스 0건.
매번 창을 다시 키워야 한다.

**11.3 자동 업데이트가 없다 · P2 · M**
`electron-updater` 미의존, `autoUpdater` 소스 0건. 버그를 고쳐도 학생에게 도달할 경로가 없다.
9.2를 먼저 하면 델타 업데이트 비용이 감당 가능해진다.

**11.4 Windows 빌드가 없다 · P2 · L**
`electron-builder.yml`에 `mac:` 타깃만 있다. 한국 대학생의 상당수가 Windows다.
webview/PATH/셸 탐색(`binaryLocator.ts`의 `/bin/zsh -lic`)·경로 처리가 macOS 전제라 이식 비용이 실재한다.
지금 결정할 필요는 없지만 **명시적으로 결정은 해야 한다**(제품 범위 문서에 적어둘 것).

**11.5 Finder에서 PDF를 더블클릭해도 반달로 안 열린다 · P3 · S**
`open-file` 핸들러 없음, `electron-builder.yml`에 `fileAssociations` 없음.

**11.6 창이 하나뿐이다 · P3 · M**
`createMainWindow()`가 기존 창을 포커스만 한다(`mainWindow.ts:20-23`).
듀얼 모니터에서 PDF와 필기를 다른 화면에 두는 건 불가능하다(같은 창 안 스플릿은 가능).

**11.7 데이터 계층 · P2**
- **다운그레이드 방어 없음** (`db/migrations.ts:78-92`) — DB 최대 버전이 코드보다 높아도
  조용히 열고 쓴다. 신버전 → 구버전 롤백 시 데이터 손상 위험. `S`
- **`busy_timeout` 미설정** (`db/database.ts:41-42`, 소스 0건) — Time Machine·외부 DB 뷰어와
  겹치면 `SQLITE_BUSY`가 그대로 IPC 오류로 터진다. `S`
- **백업·무결성 검사·복구 경로 없음** (`backup|VACUUM|integrity_check` 소스 0건).
  하이라이트·보드·대화가 전부 이 파일 하나에 있다. `M`
  (참고: `features/workspace/layoutPersistence.ts:16-17` 주석은 "회전 백업 + 원자적 쓰기가
  main-side에서 일어난다"고 적혀 있는데 **사실이 아니다** — `layoutRepo.ts`는 평범한 upsert다.
  주석을 고치거나 구현을 맞출 것.)
- **`broadcast`에 `isDestroyed()` 가드 누락** (`ipc/registerHandlers.ts:60-62`).
  같은 파일이 참조하는 `settingsStore.ts:121`은 가드가 있다. watcher 디바운스 타이머는
  창이 닫힌 뒤에도 발화하고, 그 콜백이 `broadcast('materials:changed')`다(`:85`).
  타이머 안 예외는 `handle()`의 try/catch 밖이라 **메인 프로세스 uncaught exception**이 된다. `S`
- **오류 메시지가 내부 문자열 그대로 UI에 노출** (`registerHandlers.ts:47-48`이 rethrow →
  `materialsStore.ts:29`, `coursesStore.ts:38`, `BoardPanel.tsx:64`가 `error.message`를 그대로 표시).
  화면에 `Error invoking remote method 'materials:tree': NotFoundError: [not-found] course "…"`가 뜬다.
  §7 톤 폴백 문자열은 준비돼 있는데 `error instanceof Error`가 항상 참이라 **정상 경로에서 절대 안 쓰인다**. `M`
- **`settings:set`의 `dataRoot` 무검증** (`settingsStore.ts:78-81`) — 절대경로·존재·권한 검사 없이
  `mkdirSync(join(dataRoot, slug))`로 흘러간다(`coursesRepo.ts:207-208`).
  지금은 UI가 readOnly라 노출도가 낮지만 §8.1을 구현하는 순간 실 취약점이 된다. `S`
- **`materials:import`의 소스 경로가 임의 절대경로**(`materialsRepo.ts:222-232`) —
  드래그앤드롭 전용이라는 전제에만 의존한다. `P3`

**11.8 오류를 화면에 안 알리는 곳이 많다 · P1 · S**
`showToast`는 6곳에서만 쓰이는데(`CourseSidebar`, `openMaterial`, `importDrop`, `MaterialsSidebar`)
`console.error`로 끝나는 사용자 대면 실패가 9개 파일에 흩어져 있다 —
필기 생성 실패(`NewTabMenu.tsx`), 자료 열기 실패(`openMaterial.ts`), 탭 열기 실패(`workspaceStore.ts`),
테마 로드 실패·과목 로드 실패(`AppShell.tsx`), 설정 창 열기 실패(`shortcuts.ts`).
학생에게는 "눌렀는데 아무 일도 안 일어남"으로 보인다.
토스트에 재시도 액션이 없고 중복 제거·개수 상한도 없다(`app/toast.tsx`).

---

## 12. 단축키

STYLEGUIDE §9의 5종(⌘T/⌘W/⌘P/⌘,/⌘1‥9)은 정확히 구현돼 있고 IME·webview 가드도
문서대로다(`app/shortcuts.ts`, `main/features/browser/webviewPolicy.ts:passthroughShortcut`).
학습 IDE로서 빠진 것 · P2 · S:

- **⌘F 찾기** — PDF에도 노트에도 없다(§3.2). 시험 전 복습의 기본 동작.
- **다음/이전 탭** (⌃Tab, ⌘⇧[ / ⌘⇧]) — 탭이 5개 넘어가면 ⌘1‥9만으로는 부족하다.
- **⌘⇧T 닫은 탭 다시 열기** — 실수로 ⌘W를 누르면 복구 불가(`workspaceStore.ts`에 스택 없음).
- **⌘N 새 필기**, **⌘B 보드 토글**.
- ⌘9는 브라우저 관례상 "마지막 탭"인데 여기서는 9번째다(`shortcuts.ts:66-68`).

---

## 잘 되어 있는 것 (회귀시키지 말 것)

- **webview 하드닝** — fail-closed attach + 파티션 allowlist + preload 제거 +
  `will-navigate`/`will-redirect` 양쪽 가드 + deny-by-default 권한. orca 레시피가 제대로 이식됐다.
- **경로 탈출 방어** — `db/validate.ts:45-75`의 `resolveInside`가 null byte·절대경로·`..`를
  전부 막고 자료/노트 양쪽에 일관 적용된다. `courseFolder.ts:39`는 `realpathSync.native`로
  심볼릭 링크까지 정규화한다. preload는 push 채널 화이트리스트를 강제한다. **경로 탈출 취약점은 찾지 못했다.**
- **레이아웃 영속화** — `layoutPersistence.ts`의 하드 검증(dangling 패널 드롭 + 그리드 프루닝,
  절대 throw 안 함)과 `structuralKey` 장식 변경 무시가 orca 5번을 정확히 따랐다.
- **마이그레이션** — 버전 테이블 + 트랜잭션 단위 적용(`db/migrations.ts:77-93`), WAL + FK ON,
  hot query 인덱스, 단일 인스턴스 락을 userData 경로 설정 **이후에** 요청하는 순서까지 맞다.
- **주석 앵커** — `lib/quoteAnchor.ts`가 whitespace 관용 + 컨텍스트 점수로 중복 인용을
  구분하고 `MAX_OCCURRENCES = 64`로 병적 페이지를 방어한다. 테스트 15케이스.
- **하이라이트 z-index 설계** — 텍스트 선택을 막지 않는다(`pdf.css:211-218`). 흔히 틀리는 부분.
- **에이전트 런타임** — 프로세스 그룹 킬, seq-gap 재수화, 원자적 턴 커밋,
  `streamMapper`/`chatModel`/`eventBatcher`/`jsonlStream` 테스트 커버리지.
- **채팅 CSS** — 590 + 458줄에 raw 색상 0건, 모션 transform/opacity만,
  `focus-visible`을 base.css에 위임, §7 표준 문구를 글자 단위로 지켰다.
- **§7 표준 문구 준수** — 표 10행 중 9행이 글자 단위로 일치한다. 어긋난 건 `CourseSidebar.tsx:221` 하나뿐.
- **토큰 규율** — `app/**`·`features/**`의 CSS와 TSX 전체에 raw 색상값
  (`#hex`/`rgb()`/`hsl()`/`oklch()`) **0건**. 예외로 눈감아 줄 rgba 그림자조차 없다. 드문 수준이다.
- **모션 규율** — 코드베이스의 `@keyframes` 30개 전부가 `opacity`/`transform`/`scale`만 건드린다.
  레이아웃 속성 애니메이션 0건.
- **`prefers-reduced-motion`** — `base.css:109-116`이 전역에서 죽이고, 두 엔트리 모두
  base.css를 import해 설정 창까지 커버된다(§10.6의 iteration-count 구멍만 남았다).
- **ARIA 기본기** — 랜드마크 구조, `role="switch"`+`aria-checked`, `aria-pressed`/`aria-current`/
  `aria-expanded`/`aria-busy`, 모든 오류 표면의 `role="alert"`, 아이콘 단독 버튼 라벨링이 거의 전부 되어 있다.
- **이모지·느낌표 0건** — 톤 규약의 절제가 실제로 지켜지고 있다.

---

## 확인하지 못한 것 (미확인)

- **앱 실행 관찰 전부.** 이 환경에서 `better-sqlite3` 모듈 로드가 `EINTR`로 재현 가능하게
  실패해 GUI를 띄우지 못했다. 콜드 스타트 시간, 큰 PDF 스크롤 체감, 메모리 실측,
  실제 대비비 렌더링, 두 테마 비교, 키보드 주행은 전부 다음 세션의 과제다.
- 100MB 초과 파일 / 0바이트 파일 / 확장자만 바꾼 비 PDF의 실제 화면 (코드 경로상
  전부 `ErrorPanel`로 수렴하는 것까지만 확인).
- 한글 파일명 NFD/NFC 실제 재현(§2.3) — 코드에 정규화 지점이 없다는 것만 확인.
- 네이티브 ⌘Z가 ProseMirror 문서를 실제로 깨뜨리는지(§4.1) — 플러그인 부재는 확인.
- Claude Code CLI가 allowlist된 `Write`를 자체적으로 cwd에 봉쇄하는지(§5.1).
- `--allowedTools` argv 형태가 CLI 2.1.222 외 버전에서 동작하는지(§5.19).
- iCloud 오프로드 파일에서 `statSync`가 실제로 얼마나 블로킹하는지(§1.5, §2.7).
