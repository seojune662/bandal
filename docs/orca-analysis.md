# Orca (stablyai/orca) 분석 — Bandal 반영 사항

> 출처: https://github.com/stablyai/orca (MIT, Copyright (c) 2026 Lovecast Inc.)
> 코드/패턴 재사용 가능. 실질적 부분을 그대로 이식하면 MIT 고지 유지 필요 (THIRD_PARTY_LICENSES 또는 파일 헤더).
> 분석 시점 클론: v1.4.169-rc.0. 아래 파일 경로는 Orca 저장소 기준.

## 최중요 발견: Orca의 에이전트 아키텍처는 우리 계획과 다르다

Orca는 headless stream-json이 아니라 **인터랙티브 TUI(PTY) + Claude Code hooks + 트랜스크립트 미러링**:
- `claude`를 node-pty로 실행, 구조화 이벤트는 `~/.claude/settings.json`에 관리형 hook을 설치해 로컬 HTTP 서버로 수신 (`src/main/agent-hooks/server.ts`)
- 챗 UI는 `~/.claude/projects/<slug>/<uuid>.jsonl` 트랜스크립트를 워처+증분 리더로 미러링 (`src/main/native-chat/transcript-watch-engine.ts`)
- 전송은 PTY에 bracketed-paste + 지연된 `\r` 주입, 승인은 '1'/ESC 키 원격 입력

**Bandal 결론: headless stream-json 계획 유지** (챗 우선 UX에는 더 단순). 단 Orca에 control protocol 선례는 없으므로 `can_use_tool` 스파이크는 문서 기반으로 진행. 아래는 그대로 훔칠 것들.

## 확정 변경 사항

1. **[M3-F] 브라우저: WebContentsView → 강화된 `<webview>`로 변경.**
   Orca가 의도적으로 webview를 쓰는 이유: DOM 컴포지팅에 참여해 오버레이/모달/드롭다운이 그냥 동작. WebContentsView는 모든 오버레이마다 수동 숨김 필요(보드 오버레이·다이얼로그가 많은 우리 앱에 z-order 버그 클래스 통째로 유입). 강화 레시피 이식:
   - fail-closed `will-attach-webview` (파티션 allowlist, sandbox/contextIsolation/webSecurity 강제, preload 제거) — `src/main/window/createMainWindow.ts:444`
   - `will-navigate` **와** `will-redirect` 모두 가드, `setWindowOpenHandler` → 새 탭 or shell.openExternal
   - dnd 드래그 중 webview에 `pointerEvents:'none'` (drag-passthrough refcount) — `webview-registry.ts`
2. **[M4-H] 세션 재개 레코드**: `session_id`만이 아니라 **`transcript_path` + 전체 launch config**를 함께 영속 (최신 CLI는 트랜스크립트 파일명이 session_id와 다를 수 있음 — `src/shared/agent-session-resume.ts`, `session-file-resolver.ts`). 트랜스크립트 JSONL은 크래시 복구용 무료 내구 로그로도 활용 가능.
3. **[M4-H] 모델 피커**: 하드코딩 대신 `list_models` control_request 프로브 (`src/shared/claude-model-list-probe.ts` — 작고 MIT, 거의 그대로 이식 가능. 구버전 CLI는 에러 응답하므로 정적 폴백 유지).
4. **[M4-H] 배칭 파라미터**: 40ms 디바운스 + 250ms max-wait, 프레임 타입 `snapshot | replacement | appended`, 초기 렌더 300메시지 tail + 위로 스크롤 페이지네이션 (`src/main/ipc/native-chat.ts`).
5. **[M2] 레이아웃 영속**: zustand persist 미들웨어 금지 — 명시적 순서 하이드레이션 + 장식적 변경 무시하는 diffing write-subscriber. 하이드레이션 시 강한 검증(dangling 탭/그룹 드롭, 스플릿 트리 프루닝, 파싱 실패 시 기본값), **회전 백업 5개 + 디바운스(1s) 원자적 쓰기(tmp+fsync+rename) + beforeunload 동기 플러시** (`tabs-hydration.ts`, `src/main/persistence.ts`).
6. **[M2] 무거운 패널 분리**: browser/터미널류 패널은 탭 DOM 수명에 묶지 않는다. dockview 패널은 placeholder, 실제 guest는 워크스페이스 레벨에서 bounds 동기화 (탭 이동/스플릿 시 재부모화로 guest 파괴 방지). 탭 모델에 `isPreview`, `isPinned` 필드 여지.
7. **[M5] STYLEGUIDE.md 작성**: Orca `docs/STYLEGUIDE.md`(314줄) 패턴 — "chrome은 물러나고 색은 상태 표현에만", role/anti-role 토큰 표("destructive를 Cancel에 쓰지 마라"), radius는 `calc`로 단일 `--radius`에서 유도. 폴리시 전에 문서 먼저.
8. **[M6] 온보딩 3분리**: 버전드 위저드(`OnboardingState {flowVersion, ...}`) + 활성화 체크리스트(실제 액션 지점에서 멱등 마킹) + **라이브 프로브 기반 셋업 가이드**(저장 플래그가 아니라 "지금 claude 설치돼 있나/로그인돼 있나"를 실시간 확인) + Landing preflight 카드(개별 dismiss 가능).
9. **[참고] node:sqlite**: Orca는 네이티브 리빌드/ABI 고통 때문에 better-sqlite3 → Electron 내장 `node:sqlite`(69줄 어댑터)로 이전. 우리 Electron 35(Node 22)에선 experimental 플래그 문제가 있어 당장 전환 안 함. **Electron 메이저 업그레이드 태스크와 묶어 재평가.** M1-A의 repo 인터페이스 뒤에 숨겨져 있으므로 전환 비용 낮음.
10. **[참고] PATH/정리**: PTY 없이도 로그인 셸 경유 env 해석(`shell-startup-env.ts`), 종료는 pid가 아닌 **프로세스 그룹** 킬(`posix-pty-process-groups.ts`).

## 마일스톤별 딥리딩 파일 목록 (필요 시 클론해 참조)

- M2: `src/shared/types.ts:807-1200`, `store/slices/tabs.ts`, `tabs-hydration.ts`, `workspace-session-schema.ts`, `tab-create-menu-options.ts` ("+"는 타입드 옴니박스: URL→브라우저, 경로→파일, 에이전트명→에이전트)
- M3: `PdfViewer.tsx`(raw pdfjs + 스크롤 위치 LRU 캐시 — 스크롤 기억 아이디어 이식), `markdown-round-trip.test.ts`(편집→직렬화→파싱 안정성 테스트 패턴), `browser-manager.ts`
- M4: `native-chat/` 전체, `agent-hook-listener.ts:640-930`, `native-chat-tool-fold.ts`(도구 호출 접기 UI)
- M5: `docs/STYLEGUIDE.md`, `assets/main.css`
- M6: `use-onboarding-flow.ts`, `setup-guide/use-setup-guide-progress.ts`, `Landing.tsx` + `landing-preflight-issues.ts`
