<p align="center">
  <img src="resources/icon.png" width="128" alt="Bandal app icon" />
</p>

# 반달 (Bandal)

**대학생을 위한 학습 IDE.** 과목별 워크스페이스 안에서 PDF 강의자료에 주석을 달고,
마크다운으로 필기하고, 내장 브라우저로 자료를 찾고, 학업 보드로 할 일을 관리합니다.
AI 튜터는 별도 API 키 없이 **사용자 본인의 Claude 구독**(Claude Code)으로 동작합니다.

- **과목 워크스페이스** — 과목마다 독립된 탭 레이아웃(dockview)과 자료 폴더 (`~/Documents/Bandal/<과목>`)
- **PDF 주석** — 가상화된 페이지 렌더링, 하이라이트/인용 앵커, 주석에서 바로 AI 질문
- **마크다운 필기** — Milkdown 기반 WYSIWYG, 자동 저장, 디스크 충돌 감지
- **내장 브라우저** — 샌드박스가 강제된 webview 게스트 레이어
- **학업 보드** — 과목 필터·마감일 배지가 있는 칸반 보드
- **AI 튜터** — 헤드리스 Claude 에이전트 런타임, 도구 사용 권한 승인 UI
- **플러그인 v2** — 명령·메뉴·선택 편집·패널·설정·테마 확장, 로컬 개발과 심사형 마켓플레이스

## 개발

요구 사항: Node 24.x, pnpm 9.15.4, macOS (패키징·E2E 기준).

```bash
pnpm install        # postinstall이 better-sqlite3를 Electron ABI로 리빌드
pnpm dev            # electron-vite 개발 모드 (HMR)
pnpm typecheck      # main/preload + renderer 타입 검사
pnpm deadcode       # 미사용 파일·export·dependency 검사
pnpm test           # vitest 단위·통합 테스트
pnpm e2e            # 프로덕션 빌드 후 Playwright Electron E2E (임시 프로필 사용)
pnpm plugin:test    # 플러그인 CLI 생성·검증·패키징과 예제 검증
pnpm marketplace:test # Docker + Supabase CLI로 격리된 로컬 서비스 통합 검사
pnpm dist           # electron-builder로 .dmg/.zip 생성 (release/)
pnpm generate-icon  # resources/ 아이콘 재생성 (SVG → PNG → icns)
```

E2E는 `BANDAL_USER_DATA_DIR`·`BANDAL_DATA_ROOT` 환경변수로 앱을 임시 프로필에
격리하므로 실제 사용자 데이터를 건드리지 않습니다.

## 아키텍처

Electron(main/preload/renderer) 3-프로세스 구조입니다. main 프로세스가 SQLite
(better-sqlite3)와 파일시스템(과목 폴더, chokidar 감시)을 소유하고, 타입이 지정된
IPC 계약(`src/shared/ipc`)만을 통해 renderer와 통신합니다. renderer는 React +
Zustand 스토어와 feature 단위 디렉터리(`src/renderer/src/features/*`)로 구성되며,
preload는 `window.bandal` 브리지 하나만 노출합니다(contextIsolation·sandbox 활성).
자세한 문서는 [docs/](docs/)를 참고하세요.

플러그인 개발은 [API v2](docs/plugins-v2.md), 서버 연결과 배포 준비는
[마켓플레이스 운영](docs/marketplace.md)을 참고하세요. 서비스는 별도 설정이 필요하며
로컬 폴더 플러그인은 서버 연결 없이 사용할 수 있습니다.

## 라이선스

[MIT](LICENSE) © 2026 Bandal contributors
