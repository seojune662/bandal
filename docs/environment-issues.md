# 개발 환경 문제 (2026-08-05 발견 · 2026-08-06 해결)

이 문서는 **이 머신의 환경 문제**를 기록한다. 코드 결함이 아니라 도구가 오작동하게 만드는 원인이므로,
증상을 코드 버그로 오진하지 않도록 먼저 읽을 것.

> **결론부터**: 2026-08-06 에 리포를 `~/Desktop/bandal` → **`~/dev/bandal`** 으로 옮겨 §1·§2 가 해결됐다.
> typecheck 19분47초 → **1.55초**, build 15분 → **2.75초**, test 673개 → 2.36초.
> §3(앱 데이터 루트가 iCloud 로 올라감)은 **아직 미해결**이며 설계 문제로 남아 있다.

---

## 1. 진짜 원인은 iCloud eviction 이었다 (디스크 포화가 아니라)

2026-08-05 시점의 이 문서는 모든 증상을 "디스크 100%"로 돌렸다. **그 진단은 틀렸다.**
2026-08-06 재부팅 후 여유 17GB 인 상태에서 다시 측정했더니 여전히 20분이 걸렸고, 내역은 이랬다:

```
pnpm typecheck   CPU 4.60초  /  벽시계 19분 47초
pnpm build       CPU 4.88초  /  벽시계 15분 00초
```

**연산은 5초도 안 걸렸다. 나머지 전부가 파일 대기였다.**

`~/Desktop` 이 iCloud 데스크톱·문서 동기화 대상(`FXICloudDriveDocuments = 1`)이라
`node_modules`(774MB) 파일 대부분이 `dataless` 상태 — 로컬엔 껍데기만 있고 실체는 클라우드에 있었다.
tsc/vite 가 파일을 하나 만질 때마다 iCloud 가 하나씩 다운로드했다.

디스크가 빡빡할 때 macOS 가 더 공격적으로 evict 하므로 "디스크가 원인"처럼 보였을 뿐이다.
디스크 여유는 **eviction 을 심하게 만드는 조건**이지 근본 원인이 아니다.

### 진단법

```bash
ls -lO node_modules/typescript/lib/_tsserver.js
# 플래그에 dataless 가 있으면 그 파일은 클라우드에 있다
#   hidden                      → 실체화됨 (로컬)
#   hidden,compressed,dataless  → 껍데기 (접근 시 다운로드)

time pnpm typecheck
# user CPU 와 total 이 크게 벌어지면 연산이 아니라 I/O 대기다
```

### 해결 절차 (실제로 수행한 것)

```bash
rm -rf node_modules out                      # 그대로 mv 하면 774MB 를 전량 다운로드해야 한다
mkdir -p ~/dev
mv ~/Desktop/bandal ~/dev/bandal             # 23초
cd ~/dev/bandal && pnpm install              # 19초 (better-sqlite3·canvas 네이티브 리빌드 포함)
```

pnpm 스토어는 `~/Library/pnpm/store/v3`(597MB)로 iCloud 밖에 있어 재설치가 로컬에서 끝난다.

Claude 세션 기록·메모리는 경로를 키로 쓰므로 함께 옮겼다:
`~/.claude/projects/-Users-iseojun-Desktop-bandal` → `-Users-iseojun-dev-bandal` 복사.

### 2026-08-05 당시의 증상들 (모두 같은 뿌리)

| 관측된 증상 | 실제 원인 |
|---|---|
| `node_modules` 파일이 `stat`은 되는데 **읽기 실패** | 손상이 아니라 dataless 파일 다운로드 실패/지연 |
| `better-sqlite3` 로드 시 **`EINTR`** 반복 | 다운로드 대기 중 시그널 인터럽트 |
| `tsc --noEmit`이 **52분** | eviction + 다중 에이전트 경합 |
| `pnpm dist` 산출물 zip이 **0바이트** | 쓰기 도중 공간 부족 (이건 실제로 디스크 문제) |
| `git status` / `git commit` **무한 대기** | §2 |

### ⚠️ `pnpm store prune`은 역효과였다

공간 확보용으로 실행했더니 ~800MB 가 반환됐지만, 이후 `pnpm install` 한 번에
**679개 패키지를 다시 내려받았다**. 순증이 거의 없거나 오히려 손해다. **다시 하지 말 것.**

### 손대지 않은 것 — 사용자 판단 필요

`~/.cache` 아래에 다른 작업의 캐시가 있다. **지우지 않았다.**
`huggingface` 1.5GB · `codex-runtimes` 1.5GB · `uv` 978MB · `rtmlib` 150MB

---

## 2. git 이 멈추던 문제 — 해결됨

같은 원인이었다. 작업트리를 전수 스캔하는 git 명령이 dataless 파일의 재다운로드를 유발했고,
그래서 `git status` / `git commit`(포슬린)만 무한 대기하고
`rev-parse` / `cat-file` / `log` 처럼 스캔하지 않는 명령은 멀쩡했다.

**리포를 옮긴 뒤로는 포슬린 git 도 즉시 끝난다. 아래 우회법은 더 이상 필요 없다.**
(다른 iCloud 폴더의 리포에서 같은 증상을 만나면 참고용으로 남겨둔다.)

```bash
git add <경로들>
TREE=$(git write-tree)
COMMIT=$(git commit-tree $TREE -p $(git rev-parse HEAD) -m "메시지")
git update-ref HEAD $COMMIT
```

멈춘 git 이 `.git/index.lock` 을 남기면 프로세스를 죽인 뒤 `rm -f .git/index.lock`.

---

## 3. `~/Documents/Bandal`이 iCloud로 올라간다 — 미해결 설계 문제

앱의 기본 데이터 루트가 `~/Documents/Bandal`인데 문서 폴더가 iCloud 동기화 대상이다.
**§1 을 겪고 나면 이게 왜 심각한지 분명해진다 — 사용자 머신에서 똑같은 일이 벌어진다.**

- **강의 자료가 조용히 iCloud에 업로드된다** — 사용자가 동의한 적 없는 동작이고, 교수 저작물이 클라우드로 간다
- 용량 부족 시 evict 된 PDF에 접근하면 앱이 멈춘다(`statSync` 블로킹). 우리가 tsc 로 겪은 것과 같은 현상이다
- chokidar 워처가 플레이스홀더 변동을 실제 변경으로 오인한다

→ `docs/improvement-backlog.md` 에 개선 항목으로 있다. **폴더 기반 과목 추가(사용자가 경로를 직접 지정)가
이 문제의 근본 해법**이므로 우선순위가 높다.

---

## 4. 작업 시 지켜야 할 규칙

1. **작업 전 다른 claude 세션이 떠 있는지 확인.** 2026-08-06 에 세션 3개가 같은 리포에서 동시에 돌며
   중복 `pnpm build` 와 예상 못 한 `git add`(빌드 임시파일이 인덱스에 올라감)를 일으켰다.
   ```bash
   ps -Ao pid,etime,command | grep '[c]laude'
   ```
2. **자격증명을 리포 안 메모에 두지 말 것.** `untitled.md` 에 Google OAuth client secret 이 평문으로 있었다.
   `.gitignore` 에 `untitled.md` / `scratch.md` / `electron.vite.config.*.mjs` 를 추가해 막아뒀지만, 근본적으로는 리포 밖에 둬야 한다.
3. `codex exec` 는 반드시 `< /dev/null` — 없으면 stdin EOF 를 무한 대기하며 행이 걸린다.
4. 빌드 산출물(`release/`, `out/`, `dist/`)은 언제든 재생성 가능하므로 공간이 급하면 먼저 지운다.
5. ~~동시 실행 에이전트 1개~~ — eviction 이 원인이었으므로 이 제약은 해제됐다. 다만 §4.1 은 여전히 유효하다.
