# 개발 환경 문제 (2026-08-05 발견)

이 문서는 **이 머신의 환경 문제**를 기록한다. 코드 결함이 아니라 도구가 오작동하게 만드는 원인이므로,
증상을 코드 버그로 오진하지 않도록 먼저 읽을 것.

---

## 1. 디스크가 100% 찼다 — 모든 증상의 근원

```
/System/Volumes/Data   460Gi 총량 · 422Gi 사용 · 여유 3~6Gi (100%)
```

이것이 아래 현상들의 실제 원인이다. 각각이 별개 버그처럼 보이지만 전부 같은 뿌리다.

| 관측된 증상 | 실제 원인 |
|---|---|
| `node_modules`의 파일이 `stat`은 되는데 **읽기가 실패** (M5 작업 중) | 쓰기 실패로 생긴 손상 파일 |
| `better-sqlite3` 로드 시 **`EINTR`** 반복 (앱 QA 불가) | 디스크 압박 |
| `tsc --noEmit`이 **52분** 경과해도 안 끝남 (정상 14초) | 다중 에이전트 + 꽉 찬 디스크 경합 |
| `pnpm dist` 산출물 zip이 **0바이트** | 쓰기 도중 공간 부족 |
| `git status` / `git commit`이 **수 분~무한 대기** | §2 참조 |

### 정리해서 확보한 것 (총 ~1.4GB)
- Orca 클론 임시본 238MB (분석은 `docs/orca-analysis.md`에 추출 완료)
- `release/mac-arm64/` 언팩 앱 401MB (dmg는 보존, `pnpm dist`로 재생성 가능)
- `pnpm store prune` ~800MB
- `bandal-web/node_modules` 176MB (`dist/`는 보존, `pnpm i`로 복구)

### 손대지 않은 것 — 사용자 판단 필요
`~/.cache` 아래에 다른 작업의 캐시가 있다. **지우지 않았다.**
- `huggingface` 1.5GB · `codex-runtimes` 1.5GB · `uv` 978MB · `rtmlib` 150MB

근본적으로 422GB를 쓰고 있는 것이 문제이므로 사용자의 정리가 필요하다.

---

## 2. 리포가 iCloud 동기화 폴더에 있다 → git이 멈춘다

리포 위치가 `~/Desktop/bandal`이고 **데스크톱·문서 iCloud 동기화가 켜져 있다**
(`FXICloudDriveDocuments = 1`). 디스크가 차면 macOS가 동기화 파일을 오프로드하고,
`stat`이 재다운로드를 유발한다 — 디스크가 꽉 찬 상태에서는 이게 끝나지 않는다.

**작업트리 전체를 스캔하는 git 명령만 멈춘다:**

| 명령 | 상태 |
|---|---|
| `git rev-parse` · `cat-file` · `log --oneline -3` | ✅ 즉시 |
| `git add <경로>` | ✅ 동작 (느릴 수 있음) |
| `git status` | ❌ 무한 대기 |
| `git commit` (포슬린) | ❌ 4분+ 경과해도 미완료 |

### 우회법 — plumbing 커밋 (검증됨, 즉시 완료)

```bash
git add <경로들>                    # 이건 동작한다
TREE=$(git write-tree)
COMMIT=$(git commit-tree $TREE -p $(git rev-parse HEAD) -m "메시지")
git update-ref HEAD $COMMIT
```

작업트리 스캔 없이 인덱스 내용만 커밋하므로 즉시 끝난다.
`git status` 대신 `git --no-pager diff --cached --name-only`로 스테이징 내역을 확인한다.

멈춘 git이 `.git/index.lock`을 남기면 프로세스를 죽인 뒤 `rm -f .git/index.lock`.

---

## 3. `~/Documents/Bandal`이 iCloud로 올라간다 — 설계 문제

앱의 기본 데이터 루트가 `~/Documents/Bandal`인데 문서 폴더가 iCloud 동기화 대상이다. 결과:

- **강의 자료가 조용히 iCloud에 업로드된다** — 사용자가 동의한 적 없는 동작이고, 교수 저작물이 클라우드로 간다
- 용량 부족 시 오프로드된 PDF에 접근하면 앱이 멈춘다(`statSync` 블로킹)
- chokidar 워처가 플레이스홀더 변동을 실제 변경으로 오인한다

→ `docs/improvement-backlog.md`에 개선 항목으로 있다. **폴더 기반 과목 추가(사용자가 경로를 직접 지정)가
이 문제의 근본 해법**이므로 우선순위가 높다.

---

## 4. 작업 시 지켜야 할 규칙

1. **동시 실행 에이전트는 1개.** 2개 이상이 `tsc`/`vitest`/`pnpm build`를 동시에 돌리면
   14초짜리 typecheck가 50분이 된다. 이건 추정이 아니라 관측된 사실이다.
2. **커밋은 plumbing으로** (§2).
3. **`git status`를 쓰지 말 것.** 변경 확인은 `git --no-pager diff --cached --name-only`,
   또는 `find src -newer <기준파일> -mmin -N`.
4. 에이전트 생존 확인은 태스크 로그 파일의 mtime으로:
   `stat -f "%Sm" -t "%H:%M:%S" <task-output-file>` — 30분 이상 정체면 죽은 것으로 간주.
5. 빌드 산출물(`release/`, `out/`, `dist/`)은 언제든 재생성 가능하므로 공간이 급하면 먼저 지운다.
