# 플러그인 마켓플레이스 운영

현재 구현은 로컬 검증 및 배포 준비 상태입니다. 이 작업에서 운영 프로젝트에 마이그레이션·서비스 배포·심사자 등록을 실행하지 않았습니다. 로컬 폴더 플러그인은 서비스 연결 없이 사용할 수 있습니다.

## 구성

- `server/marketplace`: Node 24 HTTP 서비스. 인증 토큰 검증, ZIP 검사, SHA-256 계산, 비공개 Storage 다운로드를 담당합니다.
- `supabase/migrations/20260905000000_marketplace.sql`: 개발자·플러그인·버전·심사자·신고·감사 이력 및 RLS, 비공개 버킷을 생성합니다.
- 앱 설정 → 플러그인 → 개발자: 기존 Supabase 로그인으로 개발자 등록, ZIP 제출, 제출 버전 조회, 검토 파일 다운로드를 제공합니다. 심사자 계정은 승인·반려·게시 중단·신고 처리 UI를 추가로 봅니다.
- 앱 탐색: 승인된 최신 SemVer만 카탈로그에 표시합니다. 설정된 서비스 출처만 ‘심사 완료’ 표시를 받으며 공식 Bandal 카탈로그의 공식 표시와 구별합니다.

각 버전은 심사 전 비공개이고 같은 `(plugin_id, version)`을 덮어쓸 수 없습니다. 반려된 버전은 새 버전으로 제출하세요. 업데이트도 재심사합니다. 승인된 파일만 공개 다운로드할 수 있으며 게시 중단 즉시 다운로드를 거부합니다. 버전 상세에는 중단 사유가 남습니다. 이미 설치된 코드를 원격으로 자동 제거하거나 강제 종료하지는 않습니다.

## 로컬 검증

Docker와 Supabase CLI, Node 24, pnpm이 필요합니다.

```sh
pnpm marketplace:test
pnpm marketplace:build
```

테스트 스크립트는 임시 프로젝트와 포트 56520–56522를 사용합니다. 실제 Auth 사용자·RLS·Storage를 통해 소유권, 심사 전 비공개, 승인 후 다운로드, 중단, 신고 처리, 감사 기록을 검사합니다. 기존 프로젝트를 초기화하지 않으며 종료 시 자신이 만든 스택과 임시 디렉터리만 정리합니다. 테스트 로그에 키를 출력하지 않습니다. 일반 `pnpm test`에서는 이 외부 의존 테스트가 건너뛰어집니다.

## 서비스 설정과 배포 순서

1. 대상 Supabase 프로젝트의 DB와 Storage를 백업하고 마이그레이션을 스테이징에서 먼저 검증합니다. 기존 앱의 인증 프로젝트와 같은 프로젝트를 사용해야 기존 로그인이 그대로 작동합니다.
2. 운영자의 명시적인 배포 승인 후 새 마이그레이션을 적용합니다. 이미 적용된 마이그레이션 파일을 수정하지 말고 후속 마이그레이션으로 변경하세요.
3. 서버에 아래 환경변수를 비밀 관리 시스템을 통해 주입합니다. **서비스 역할 키를 Electron 빌드나 renderer에 넣지 마세요.**

| 서버 변수 | 값 |
| --- | --- |
| `SUPABASE_URL` | 대상 Supabase API URL |
| `SUPABASE_PUBLISHABLE_KEY` | 같은 프로젝트의 공개/anon 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 서비스 역할 키 |
| `MARKETPLACE_PUBLIC_URL` | HTTPS 서비스 origin, 예: `https://marketplace.example.com` |
| `HOST` / `PORT` | 기본 `127.0.0.1` / `4318`; 배포 플랫폼에 맞게 지정 |

```sh
pnpm marketplace:build
pnpm marketplace:start
```

4. 서비스 앞에 TLS reverse proxy를 두고 요청 본문 한도 12 MiB, 요청 시간 제한, IP/계정별 속도 제한, 정상 종료·재시작, 모니터링을 설정합니다. 서버는 요청 본문을 직접 제한하고 DB는 개발자당 시간당 10개 제출로 제한합니다. 업로드 이전의 악성 트래픽을 막는 외곽 rate limit도 필요합니다.
5. 앱 빌드에 `MAIN_VITE_MARKETPLACE_URL=https://marketplace.example.com`을 설정합니다. GitHub 릴리스는 같은 이름의 Actions **변수**를 사용하므로 서버 운영 검증 후 다음 앱 릴리스 전에 등록하세요. 개발 실행은 `BANDAL_MARKETPLACE_URL`로 덮어쓸 수 있습니다. 값은 자격증명·경로·쿼리 없는 origin이어야 합니다. 로컬 개발에 한해 `http://127.0.0.1:<port>`를 허용합니다.
6. 기존 Supabase 로그인 설정이 앱과 서버에서 같은 프로젝트를 가리키는지 확인합니다. `GET /health`, 앱 개발자 등록, ZIP 제출→검토→승인→설치→중단을 스테이징에서 반복 검증한 뒤 운영 트래픽을 연결하세요.

서버 번들은 `@supabase/supabase-js`를 외부 의존성으로 사용합니다. `out/marketplace/server.cjs`만 복사하지 말고 Node 24 및 잠금 파일에 맞는 production dependencies도 배포해야 합니다.

## 심사자 등록

운영자만 Supabase SQL 관리 화면 등 신뢰된 서버 경로에서 실행합니다. 앱이 역할을 스스로 부여할 수 없도록 RLS와 RPC 권한을 분리했습니다.

```sql
insert into public.marketplace_reviewers(user_id)
select id from auth.users where email = 'reviewer@example.com'
on conflict do nothing;
```

잘못된 계정을 등록하지 않도록 먼저 사용자 ID와 이메일을 조회·대조하세요. `bandal`, `official`, `admin`, `support` 개발자 이름 공간은 일반 앱 등록에서 예약되어 있습니다. 공식 배포 계정이 필요하면 운영자가 소유자를 확인하고 서버 권한으로 등록합니다. 표시 이름과 매니페스트의 작성자 텍스트는 신원 인증 수단이 아닙니다.

심사자는 변경 내역·매니페스트·권한·실제 ZIP을 함께 검토합니다. 패키지에 자격증명·외부 다운로드 코드·불필요한 파일·과도한 권한이 없는지 확인하고, 임시 앱 프로필에서 실행합니다. 승인·반려·게시 중단과 신고 처리에는 사유가 필요하며 감사 기록이 남습니다. 심사는 악성 코드의 안전성을 보장하지 않습니다.

## API

| 경로 | 접근 |
| --- | --- |
| `GET /health`, `/index.json`, `/releases?q=&page=` | 공개; 검색은 30개 단위, page는 0부터 |
| `GET /releases/:id` | 공개된 적 있는 승인·중단 버전의 상세 |
| `GET /releases/:id/download` | 현재 승인된 버전만 다운로드 |
| `GET /dashboard` | 로그인; 자신의 제출물, 심사자는 최근 제출물과 미처리 신고 |
| `GET /releases/:id/review-bundle` | 해당 개발자 또는 심사자 |
| `POST /publishers`, `/releases` | 로그인·소유권 검사 |
| `POST /releases/:id/review` | 심사자만 |
| `POST /reports` | 로그인; 승인된 버전당 계정별 1개 |
| `POST /reports/:id/resolve` | 심사자만; 감사 사유 기록 |

대시보드는 최근 100개 버전·미처리 신고를 표시합니다. 카탈로그 전체 인덱스는 앱에서 1 MiB 제한을 받으므로 대규모 운영 전에 인덱스 분할 또는 페이지형 탐색으로 확장해야 합니다. 이번 범위에는 별도 웹 포털, 결제, 평점, 댓글이 없습니다.

## 복구와 운영 점검

- 업로드와 DB 제출은 파일시스템·DB 전체에 걸친 단일 트랜잭션이 아닙니다. DB 제출 실패 시 업로드 파일을 정리하지만 서버 강제 종료로 고아 파일이 남을 수 있습니다. `marketplace_releases.artifact_path`와 대조한 뒤 참조되지 않은 파일만 운영자가 정리하세요.
- DB와 비공개 버킷을 함께 백업·복원합니다. ZIP을 바꾸지 말고 복원 후 SHA-256과 다운로드 검사를 수행하세요. 동일 버전 덮어쓰기는 금지합니다.
- 장애 시 서비스 URL 연결을 해제해 개발자 센터를 비활성화할 수 있습니다. 사용자의 로컬 플러그인과 설정은 유지됩니다.
- 유해 버전은 삭제 대신 게시 중단으로 전환하고 사유를 남깁니다. 이미 설치한 사용자에게 알릴 운영 채널은 별도로 마련해야 합니다.
- 로그에 Authorization, 서비스 키, ZIP 본문을 남기지 않습니다. RLS/역할/다운로드 검증을 우회하는 Storage 공개 정책을 추가하지 마세요.
