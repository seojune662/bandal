# 문서·편집 기능 검토 — 2026-10-07

## 범위와 검토 방식

정상 사용, 빠른 연속 입력, 초기 읽기와 저장의 순서 역전, 자료 전환, 저장 실패 및 재시도, 내보내기 직전 저장, 취소 및 리소스 회수, 키보드·오류 안내를 기준으로 검토했다. 아래는 실제 코드 추적과 회귀 테스트로 확인한 범위이며, 모든 OS·사용자 파일에 문제가 없다는 의미는 아니다.

| 기능 | 읽고 검토한 주요 경로 | 검토 가설/결과 |
| --- | --- | --- |
| PDF 주석/메모 | `PdfTab`, `PdfToolbar`, `PdfToolRail`, `useAnnotations`, `popovers`, `memoDraft`, main `annotationsRepo` | 초기 읽기가 늦어도 생성한 주석이 유지되는지, 색상/메모/삭제 순서, 실패 초안 유지, 내보내기 전 저장을 확인하고 수정 |
| PDF 도형·공통 잉크 | `useDrawings`, `DrawingLayer`, `InkLayer`, `TextBoxEditor`, 이미지 로드/배치·복사 경로, main `drawingsRepo`/`exportPdf` | 낙관적 미리보기와 직렬 저장, 임시 ID, undo/redo, 삭제 tombstone, 텍스트 편집 포커스, 기하 보정, 텍스트/한글 글꼴 내보내기 검토; 기존 회귀 통과 |
| 필기 | `NoteTab` 저장/복구/rename/duplicate-session 경로, `noteSessionRegistry`, `noteSaveSafety`, `noteRenameSync`, `notesRepo` | 외부 변경 충돌, single-writer, 닫을 때 보존, 동시 본문 편집, 코드 블록 제목 오인 검토; 제목 오인 수정 |
| 개인 화이트보드 | `CanvasTab`, `CanvasToolRail`, `CanvasPage`/preview/model, main `canvasRepo`/`exportBoardPdf` | 즉시 화면 반영과 저장 확인을 구분하는지, 실패 보존, 재시도, 내보내기 누락 검사; 저장 큐·상태·재시도 및 클립/사진 내보내기 수정 |
| 일반 파일 | `FileTab`, `TextViewer`, `SheetViewer`, `DocxViewer`, `PreviewFallback`, `VideoViewer`, presentation service/loader/job | 대형 자료 제한, Word HTML 제한, 취소/오류, 영상 재생 위치·PiP 넘김, 프레젠테이션 순서·취소 검토; 넓은 시트 DOM 폭증 수정 |
| 이미지/페이지 복사 | `ImageTab`, `imageSource`, `usePageImageCopy`, `pageImage`, `renderClip` | 파일별 key 분리, 이미지 크기/확대, 클립보드 취소와 owned canvas 회수, 실패 안내 검토 |
| 녹음 | `captureStore`, `RecordingTab` 상태/선택 부분, `recordingService`, `recordingRepo`, 모델·엔진 오류 경로 | 마이크 요청·엔진 시작·취소 순서, 늦은 응답, PCM 큐/flush, 중단 및 WAV 복구 검토; 취소된 시작 응답 수정 |
| 인쇄/PiP | `printStore`, `PrintPreviewOverlay`, `usePrintRequests`, main `printWindow`, `pipPlayerModel`, PiP startup/apps | 미리보기 generation, 진행 상태, 네이티브 창 취소, 영상 resume/seek 검토; 인쇄 창을 먼저 닫았을 때 미완료 Promise 수정 |

## 재현된 문제와 수정

1. **PDF 초기 읽기가 주석 생성을 덮음**: 초기 `listForFile`가 지연된 상태에서 create 응답이 먼저 오면 나중에 도착한 빈 목록이 새 하이라이트를 지웠다. 파일 세션별 읽기·쓰기 큐로 순서를 보장한다. 실제 `PdfViewer`에는 파일별 React key가 있어 일반 파일 전환은 이미 방어되어 있었고, 훅 자체에도 세션 경계를 추가했다.
2. **PDF 메모 저장 실패 후 초안 소실**: 팝오버는 저장 요청 후 닫히며 실패한 내용은 저장소에도 화면에도 남지 않았다. 실패한 메모/색상 패치를 세션에 남기고 해당 내용과 오류를 보여 준다. 다른 주석/색상 저장 성공이 실패한 메모를 지우지 않으며 ‘다시 저장’으로 복구한다. 하이라이트 생성 실패 시 텍스트 선택도 유지한다. 주석 레일을 닫아도 오류 안내가 보인다.
3. **PDF 내보내기와 주석 저장 경쟁**: 기존 내보내기는 도형 저장만 기다렸다. 텍스트 하이라이트/메모 저장과 초기 주석 읽기도 기다리고 실패 시 내보내기를 중지한다.
4. **화이트보드 저장 실패를 성공으로 표시**: 낙관적 도형은 화면에 남는데 후속의 다른 도형 저장이 오류를 지웠고 배지는 항상 저장 완료였다. 저장 큐는 도형별 실패 작업을 보존하고 재시도한다. 저장 중/실패/완료를 구분하며 PDF 내보내기는 사진 최적화/삽입·클립 비율 보정까지 기다린 다음 저장 큐와 실패 여부를 확인한다. 여러 도형 삭제 중 일부를 복원한 뒤 재시도해도 복원한 도형을 다시 삭제하지 않는다.
5. **필기 코드 내용 손상**: fenced shell 코드의 `# comment`를 첫 H1로 오인해 자동 파일 이름 변경과 본문 교체에 사용했다. 공용 `noteTitle`은 fenced code, 들여쓴 코드, HTML literal/comment, 닫힌 YAML metadata를 건너뛰고 실제 H1만 읽고 교체한다. 빈 `#`가 다음 줄까지 소비하는 문제도 함께 수정했다.
6. **취소한 녹음 시작이 새 녹음을 덮음**: 늦은 마이크 허용/엔진 응답이 전역 오디오 자원과 현재 세션을 다시 채웠다. 비동기 단계마다 capture serial을 검사하고 늦은 마이크는 중지, 늦게 시작한 엔진은 해당 세션만 interrupt한다.
7. **넓은 스프레드시트가 앱을 멈춤**: 행만 2,000개로 제한되어 A:XFD 범위에서 약 3,277만 셀을 생성할 수 있었다. 열 100개 및 총 20,000셀 상한을 적용하고 실제 표시 행·열 범위와 원본 안내를 표시한다.
8. **인쇄 창 취소 후 버튼이 영구 비활성화**: 네이티브 창 `closed`가 임시 파일만 정리하고 print Promise를 완료하지 않았다. 닫힘/동기 print 오류를 실패 결과로 완료하며 성공 callback 이후 닫힘은 성공 결과를 유지한다.
9. **화이트보드 PDF에서 모든 클립/사진 누락**: 기존 코드는 클립을 skip하고 사진 분기도 없었다. 이제 원본 PDF 페이지 영역을 벡터로 넣고 PNG/JPEG 및 Electron이 읽는 사진을 포함한다. PDF 0/90/180/270도 회전 및 CropBox를 반영하며 원본 파일/페이지가 없으면 설명과 함께 실패한다. 빈 PDF를 성공으로 알리지 않는다. 글꼴 읽기 실패 캐시는 제거해 복구 후 재시도할 수 있다.
10. **PDF 내보내기 원본 경로 검사 불일치**: course 폴더 안의 symlink가 외부 PDF를 가리키는 경로를 읽을 수 있었다. 원본 경로도 `resolveInsideReal`로 검사한다.

## 검증

- 1차 편집 관련 회귀: 55개 테스트 파일, 429개 테스트 통과 (`notes`, `ink`, `useDrawings`, main PDF/canvas, file, PiP, presentation, 인쇄 창).
- PDF 주석 신규 회귀 5개, 기존 도구 레일 4개 통과.
- 녹음 capture 7개(늦은 마이크/엔진 2개 추가) 통과.
- 시트 크기 경계 3개 통과.
- 필기 제목 공용 경계 6개 통과, main 실제 rename 사례 추가.
- 새 화이트보드 미디어 검사 6개 통과: pdf.js와 실제 canvas로 내보낸 PDF 픽셀을 읽어 4가지 회전의 crop 색상과 PNG 포함을 검증. 기존 PDF/화이트보드 텍스트·글꼴 내보내기 회귀 통과.
- 1차 변경 시점의 renderer/main TypeScript 검사 모두 통과. 2차 통합 검사는 root가 수행한다.

## 자동 검사 밖의 범위

- 실제 마이크 권한 대화상자, 물리 장치 분리, 장시간 실제 강의 인식 품질.
- 실제 프린터/운영체제 네이티브 인쇄 UI와 Windows 이미지 코덱.
- 모든 임의 PDF/Office 파일의 렌더링 일치. 표본 생성 파일·기존 fixture와 컴포넌트/저장소 검사를 사용했다.
- 저장 실패 후 앱 강제 종료 시 메모리의 미저장 초안까지 영구 보존되는 것은 보장하지 않는다. 실패 상태와 다시 저장 안내를 표시한다.
- 커밋·배포·배포 산출물 E2E는 root가 통합하여 수행한다.

## 추가 미디어 검토

- `mediaProtocol`, `mediaRegistration`, `mediaProgressRepo`, `clipboardPaste`, `imageImport`의 URI 파싱, 경로 경계, Range 요청, 최대 파일 수/크기/픽셀, 편집 필드 붙여넣기 보호를 확인했다.
- 사진 디코딩/asset 저장이나 드롭 클립 비율 보정은 저장 요청이 큐에 들어오기 전에도 진행 중일 수 있었다. `CanvasSaveQueue.prepare`가 그 작업도 추적해 내보내기에 누락되지 않도록 기다린다. 지연 디코딩 후 추가된 shape save까지 기다리는 회귀를 추가했다(큐 5개 검사 통과).
- 미디어 프로토콜/진행 저장·녹음 repo/service·clipboard paste 관련 5파일/35검사 통과.
- 실제 클립보드 OS 포맷과 메모리 압박, 플랫폼 이미지 코덱, 장기 녹음 인식은 실기기 검증 범위로 남는다.

## 실행 명령

```sh
pnpm exec vitest run tests/renderer/pdf/useAnnotations.test.tsx tests/renderer/pdf/pdfToolRail.test.tsx
pnpm exec vitest run tests/renderer/recordings/captureStore.test.ts
pnpm exec vitest run tests/renderer/file/sheetPreviewBounds.test.ts
pnpm exec vitest run tests/shared/noteTitle.test.ts tests/main/notesRepo.test.ts tests/renderer/notes/note-rename-sync.test.ts
pnpm exec vitest run tests/main/print/printWindow.test.ts tests/main/notesRepo.test.ts tests/renderer/notes tests/renderer/ink tests/renderer/pdf/useDrawings.test.tsx tests/main/pdf tests/main/canvas tests/renderer/canvas tests/renderer/file tests/renderer/pip tests/main/presentation
pnpm exec vitest run tests/main/pdf/exportPdf.test.ts tests/main/canvas/boardMediaPdf.test.ts tests/main/canvas/exportBoardPdf.test.ts
pnpm exec vitest run tests/renderer/canvas/canvasSaveQueue.test.ts tests/renderer/learning/learning-models.test.ts tests/renderer/learning/learningQuiz.test.tsx
pnpm exec vitest run tests/main/mediaProtocol.test.ts tests/main/mediaProgressRepo.test.ts tests/main/recordings/recordingRepo.test.ts tests/main/recordings/recordingService.test.ts tests/renderer/materials/clipboardPaste.test.ts
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm exec tsc --noEmit -p tsconfig.node.json
```

## root 변경 독립 검토

- `workspaceStore`의 hydration 오류·재시도, `WorkspaceHost`의 inert/콘텐츠 비활성, `materialsStore`의 refreshOnly/cache/응답 순서, `MaterialsSidebar`·`useMaterialsPaste`·`tabCommands`의 비동기 과목 범위, 공용 focus/menu의 숨김·disabled·Escape 전파를 독립적으로 읽었다.
- `createStudyTab('whiteboard')`만 아직 생성 대기 후 다른 과목이나 학습 홈을 덮는 경로가 남아 있었다. root에 먼저 보고 후 허가된 범위에서 원래 과목 확인을 추가했다. `pnpm exec vitest run tests/renderer/app/tabCommandScope.test.ts` 5개 검사(추가 3개) 통과.
- `20261007000000_whiteboard_asset_boundaries.sql`, 기존 asset migration, 격리 SQL fixture를 비교했다. 외부 board/group 컬럼 명시, 활성 board·membership·author/owner, UPDATE 기존/새 경로 조건에서 추가 배포 차단 결함을 찾지 못했다. 운영 적용이나 실제 계정 조작은 수행하지 않았다.

## 통합 E2E 후속: 포커스 없는 PDF 분할 화면

- 페이지 필기를 생성한 뒤 필기가 활성 상태일 때, PDF 페이지 입력으로 키보드 포커스만 이동해 30쪽으로 이동하면 필기 스크롤이 0에 머무르는 문제를 기존 빌드에서 재현했다. 같은 입력을 마우스로 클릭하고 실행하면 통과해 비활성 분할 패널의 처리 차이임을 확인했다.
- `PdfViewer`는 화면에 보이는 다른 분할 그룹도 `interactive=false`로 간주해 스크롤·읽기 위치·크기 변경을 무시했다. `usePanelVisible`을 분리해 현재 과목의 보이는 PDF는 포커스와 무관하게 스크롤을 처리하고, 숨겨진 탭/과목의 레이아웃 스크롤은 계속 차단한다. 펜·단축키의 활성 패널 구분은 유지한다.
- `visibleSplitPanel`과 `pageSyncScroll` 2파일/6검사, renderer 타입 검사 통과. `interactionStability` 마지막 시나리오에 PDF hover→wheel만 하는 단계도 추가했다. root가 최종 v0.74.0 빌드에서 실패 항목과 직접 영향 기능 29개를 재검사해 모두 통과했고 해당 PDF 분할 시나리오도 포함됐다.
- 명령: `pnpm exec vitest run tests/renderer/workspace/visibleSplitPanel.test.tsx tests/renderer/links/pageSyncScroll.test.ts`, `pnpm exec tsc --noEmit -p tsconfig.web.json`.
- 웹 체험 내보내기를 위한 열린 노트의 전체 Markdown snapshot accessor와 quota/다른 과목 회귀는 `audit-web-2026-10-07.md`에 기록했다.


## 마지막 시각 점검 후속: retained 패널의 오래된 overlay 크기

- 웹의 영어 320px 화면에서 PDF canvas와 텍스트가 준비된 뒤에도 본문이 보이지 않았다. 실제 그룹 콘텐츠 높이는 523.5px인데 Dockview overlay와 슬롯은 0px였고 live content가 그 0 크기를 유지해 canvas를 잘랐다. iframe을 화면 안으로 스크롤하고 기다려도 재현돼 로딩 전 캡처와 구분했다.
- `panelContentHost`는 overlay 슬롯의 간접 크기 대신 같은 workspace 안의 실제 그룹 콘텐츠 영역을 측정한다. 그룹 영역 ResizeObserver와 `onDidGroupChange`를 통해 reflow·이동을 관찰하고, 숨김/0 크기 구간의 마지막 유효한 크기 및 slot 이동 중 편집기 DOM을 보존한다. observer는 그룹 교체와 폐기 때 정리한다.
- DOM 회귀가 0/stale overlay, 실제 그룹만의 resize, hidden→visible, transfer slot 공백, 같은 API의 group 변경, 미저장 입력 보존과 해제를 검증한다. `panelContentHost`·`rebindingApi`·`visibleSplitPanel` 7개와 `browserAnchorVisibility` 1개 통과, renderer 타입 검사 통과.
- 실제 Chrome/WebKit × 한/영 × 320/1440px 8개에서 초기 표시와 reload 복원을 검사했다. canvas 존재만 확인하지 않고 실제 scroller 교차 영역과 hit-test를 요구한다. 웹 native 인쇄 메뉴 상태 동기화 no-op과 모바일 scene 메뉴 2열 배치, 최종 320px 4개 검증은 [웹 감사](audit-web-2026-10-07.md)에 기록했다.
- 공통 runtime 변경은 **v0.75.0** 대상이다. v0.74.0은 macOS 패키지 검사 성공, Windows 153개 통과·viewport 가정 관련 2개 검사 실패로 공개되지 않았다. root가 해당 검사를 실제 좌표/펼치기 동작과 1024px 창 기준으로 보완했다. root의 v0.75.0 최종 로컬 desktop 영향 E2E 16개는 모두 통과했다. 배포 패키지 검사, 커밋·릴리스 공개와 웹 배포 결과는 root 후속 기록으로 남는다.
