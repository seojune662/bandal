# Plugin sandbox 독립 검토와 앱 IPC sender 방어 — 2026-10-07

## 독립 검토

`plugins/sandboxHost.ts`, `pluginRuntime.ts`, `rpcBroker.ts`, `pluginHost/runtime.ts`, `preload/pluginHost.ts`, 빌드 entry와 실제 악성 E2E fixture를 읽었다. 새 구조는 플러그인마다 별도 session의 sandboxed WebContentsView에 고정 문서를 로드하고, DOM/Node/preload 객체가 없는 Worker에서 코드와 모든 capability를 만든다. 고정 채널 JSON 이외 Electron 객체는 전달하지 않으며, CSP와 session network deny가 직접 HTTP/WebSocket/file 접근을 제한한다. API 권한은 main broker가 승인 상태·플러그인 owner·메서드·요청 크기·빈도를 다시 확인한다.

- unattached WebContentsView wrapper의 강한 참조가 반환 뒤 사라지는 수명 문제를 platform 담당자에게 보고했다. `finish` closure가 view를 보유하고 종료 때만 해제하도록 수정되었다.
- owner ID가 없는 log/lifecycle 메시지도 거절하도록 제안했고 platform이 반영했다.
- actual transport의 forged owner/무권한 raw API/importScripts/nested Worker 시도를 기존 constructor/API 응답/오류/Promise/타이머/직접 네트워크/무한 timer loop E2E에 추가하도록 제안했고 platform이 반영했다.
- 코드 검토에서 새 sandbox JavaScript의 Node 또는 무권한 직접 네트워크 탈출을 추가로 재현하지는 않았다. 실제 E2E 실행은 platform/root 결과를 따른다.

## 앱 IPC 방어 강화

일반 contract handler는 sender를 검증하지 않았다. 기존 pluginHost preload가 고정 채널만 노출해 직접 우회가 확인된 상태는 아니지만, 새 실행 renderer와 앱 renderer의 권한을 명시적으로 구분하도록 root 요청에 따라 방어를 추가했다.

- `rendererSender.ts` 순수 정책은 BrowserWindow 자체 WebContents의 최상위 프레임만 허용한다. 같은 파일을 로드한 guest/WebContentsView, subframe, 종료된 frame/window는 거절한다.
- 허용 문서는 빌드 renderer 디렉터리의 `index.html`, `settings.html`, `overlay.html`, `pip.html`뿐이다. query/hash는 정상 view 정보이므로 허용한다.
- 개발 실행은 설정된 `ELECTRON_RENDERER_URL`의 origin과 실제 페이지 경로만 허용한다. 실제 mainWindow는 `${dev}/index.html`, PiP/capture는 `${dev}/pip.html`·`${dev}/overlay.html`을 로드하므로 `/`를 별도 허용하지 않는다. 패키지 앱에는 dev URL 허용을 적용하지 않는다.
- `registerHandlers.handle`, `materials:startDrag`, `window:openSettings`는 요청 내용을 읽거나 부작용을 실행하기 전에 검증한다.
- `startup:ready`는 preload가 URL 확정 전에 요청하는 읽기 전용 Promise barrier라 유지한다. 자료나 부작용 권한을 주지 않으며 이후 계약 요청은 모두 검증한다.

## 검증

- `pnpm exec vitest run tests/main/rendererSender.test.ts tests/main/ipcCoverage.test.ts`: 2파일/34검사 통과.
- `pnpm exec tsc --noEmit -p tsconfig.node.json`: 통과.
- `e2e/ipcSender.spec.ts`: root 통합 새build에서 실행할 fixture 작성. 실제 guest·subframe·null frame event로 계약·설정 창·drag 경로가 요청 읽기 전 거절되는지 검사한다. 앱 preload를 가진 외부 data 문서에서 실제 settings:set 호출을 거절하고, 정상 settings/overlay/PiP 파일에서 settings:get은 허용하는지 확인한다.

운영 OS renderer sandbox 자체의 취약점 유무, 모든 Chromium API와 OS exploit은 이 코드 감사가 증명하지 않는다. E2E는 로컬 임시 프로필에서 수행하며 실제 사용자 데이터/권한 허용은 사용하지 않는다.
