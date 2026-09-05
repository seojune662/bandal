# Bandal 플러그인 API v2

Bandal 전용 확장 API입니다. VS Code/Obsidian의 플러그인을 그대로 실행하지 않습니다. `manifestVersion: 1`의 기본 API는 계속 지원하며, v2는 명령·단축키·패널에 설정 스키마·메뉴·선택 편집·토큰 테마를 더합니다.

## 개발과 설치

Node 24와 저장소 의존성이 필요합니다.

```sh
pnpm plugin create /absolute/path/my-plugin publisher.my-plugin
pnpm plugin validate /absolute/path/my-plugin
pnpm plugin pack /absolute/path/my-plugin /absolute/path/my-plugin.zip
pnpm plugin:test
```

`create`는 새 폴더만 만들고 기존 폴더를 덮어쓰지 않습니다. `pack`도 기존 ZIP을 덮어쓰지 않으며 재현 가능한 ZIP과 SHA-256을 출력합니다. 숨김 파일, `node_modules`, `dist`는 포함하지 않으며 심볼릭 링크는 거부합니다. TypeScript/React 소스는 개발자가 먼저 단일 CommonJS `main.js`와 패널 JS로 번들링해야 합니다. 런타임에는 `require`가 없습니다.

설정 → 플러그인에는 **탐색 / 설치됨 / 업데이트 / 개발자**가 있습니다. 폴더·카탈로그에서 설치한 뒤 설치됨에서 권한을 검토하고 승인·활성화합니다. 개발자 탭의 개발 폴더 연결은 변경을 감지하여 검사 후 설치본을 갱신하고 비활성화합니다. 변경된 코드·자산은 다시 승인해야 합니다. 감시는 앱 종료 시 종료되며 재실행 후 다시 연결합니다.

ZIP 배포·심사 절차는 [마켓플레이스 운영 문서](marketplace.md)에 있습니다. 타입은 [`sdk/plugin-api/index.d.ts`](../sdk/plugin-api/index.d.ts)의 `Bandal`, `BandalPlugin`입니다. 별도 서비스 연결 없이 로컬 개발·설치가 가능합니다.

## 매니페스트와 코드

```json
{
  "manifestVersion": 2,
  "id": "publisher.my-plugin",
  "name": "선택 텍스트 도구",
  "version": "1.0.0",
  "minAppVersion": "0.42.0",
  "description": "선택한 텍스트를 대문자로 바꿉니다.",
  "author": "Publisher",
  "main": "main.js",
  "permissions": ["commands", "menus", "editor.read", "editor.write", "settings"],
  "contributes": {
    "commands": [{ "id": "transform", "title": "선택 텍스트 변환", "defaultChord": "mod+alt+u" }],
    "menus": [{ "location": "editor", "command": "transform" }],
    "settings": [{ "key": "enabled", "title": "변환 허용", "type": "boolean", "default": true }]
  }
}
```

```js
module.exports = {
  async activate(bandal) {
    // activate 중에도 이미 승인된 API를 사용할 수 있습니다.
    await bandal.settings.get('enabled')
    bandal.commands.register('transform', async () => {
      if (!await bandal.settings.get('enabled')) return
      const selected = await bandal.editor.getSelection()
      if (selected?.text) {
        await bandal.editor.replaceSelection(selected.token, selected.text.toUpperCase())
      }
    })
  }
}
```

앱이 `activate(bandal)`에 API를 주입합니다. `deactivate()`는 선택 사항이며 비활성화 시 프로세스가 종료되므로 영속 데이터 저장을 종료 콜백에만 의존하지 마세요. 타이머·이벤트·명령은 호스트 종료와 함께 정리됩니다.

매니페스트 ID는 소문자 영숫자·하이픈의 점 구분 이름이며 최대 128자입니다. 명령·패널·테마 ID는 소문자 영숫자·하이픈으로 최대 48자입니다. 이름 40자, 설명 300자, 작성자 표시 80자 이내입니다. 버전은 SemVer이며 설치 시 앱 최소 버전과 카탈로그의 버전·해시를 확인합니다.

한 플러그인에 명령 32개, 패널 4개, 메뉴 32개, 테마 8개, 설정 64개까지 선언할 수 있습니다. 폴더 설치는 파일 200개/폴더 포함 500개/깊이 32단계/전체 20 MiB, 매니페스트 32 KiB, 메인 파일 2 MiB 제한입니다. CLI·카탈로그 배포는 ZIP과 압축 해제 크기를 각각 8 MiB로 제한합니다.

## v2 추가 API

| 권한 | 추가 기능 |
| --- | --- |
| `menus` + `commands` | 선언된 명령을 편집·자료 메뉴에 표시 |
| `editor.read` | `editor.getSelection()` |
| `editor.write` | `editor.replaceSelection(token, text)` |
| `settings` | `contributes.settings` 스키마, 기본값·값 검증 |
| `events` | `events.on('settings:changed', handler)` |
| `panel` | `panel.close(id)` |
| `themes` | `contributes.themes` 토큰 테마 |

과목·필기·자료·네트워크 등 기존 API는 [기본 API 문서](plugins.md#bandal-api)를 참고하세요. `notes.list`의 ID를 `notes.read/write`에 전달하며 `notes.read`는 `content`, `mtime` 등을 반환합니다. 전체 파일을 수정할 때는 읽은 `mtime`을 `expectedMtime`으로 보내 충돌을 감지하세요. 현재 편집 중인 필기에는 선택 편집 API를 사용하세요.

### 명령과 메뉴

명령 핸들러는 메뉴 실행 시 `{ courseId, relPath }`, 일반 실행 시 `null` 컨텍스트를 받습니다. 명령은 새 탭 명령 검색과 단축키 설정에도 나타납니다. `menus.location`은 필기 툴바의 더 많은 서식 메뉴인 `editor`, 자료 우클릭 메뉴인 `materials`입니다. 선언되지 않은 명령을 메뉴에 참조할 수 없습니다.

### 선택 편집

`getSelection()`은 활성 필기의 `{ token, courseId, relPath, from, to, text }` 또는 `null`을 반환합니다. 토큰은 해당 플러그인 소유이며 60초 동안 한 번만 사용할 수 있습니다. 플러그인별 마지막 토큰만 유효합니다. 문서·선택·활성 탭·파일 경로가 바뀌면 수정은 거절됩니다. 최대 100,000자이며 ProseMirror 트랜잭션으로 적용되어 실행 취소와 자동 저장을 거칩니다. 거절되면 선택을 다시 읽어야 합니다.

### 설정 스키마

각 항목은 `key`, `title`, `type`, `default`와 선택적인 `description`을 가집니다. 타입은 `string`, `number`, `boolean`, `select`; 선택형은 `options`, 문자열·숫자는 `min/max`를 지원합니다. 문자열 최대 길이는 4,096자입니다. 중복/위험한 키와 잘못된 기본값은 설치 단계에서 거절됩니다.

설치됨의 플러그인 설정 화면은 이 스키마에서 생성됩니다. 기본값 복원은 선언된 키만 초기화하며 패널 상태 등 비공개 키를 지우지 않습니다. `settings.get`은 선언된 키의 기본값을 반환하고 `settings.set`은 타입·범위를 검사합니다. 저장 완료 후 해당 플러그인에만 `settings:changed` 이벤트 `{ pluginId, values }`가 전달됩니다. 비공개 키도 사용할 수 있으며 전체 JSON 저장 한도는 256 KiB입니다.

### 패널

`contributes.panels`에 `{ id, title, entry: 'index.html' }`을 선언합니다. `entry`는 `ui/` 기준입니다. `panel.open`은 기존 패널을 포커스하고 `panel.close`는 해당 플러그인의 해당 패널만 닫습니다.

패널의 `window.bandal.postMessage(payload)` ↔ 호스트의 `panel.onMessage`, 호스트의 `panel.post` ↔ 패널의 `window.bandal.onMessage`로 통신합니다. 패널이 준비됨 메시지를 보내면 호스트가 설정에 보관한 상태를 돌려주는 방식으로 복원할 수 있습니다. 패널 DOM 상태 자체가 자동 저장되지는 않습니다.

패널은 전용 `bandal-plugin://` webview와 고정 CSP에서 실행됩니다. 인라인 JS·외부 CDN·네트워크 직접 연결·폼 제출은 금지됩니다. 별도의 JS 파일을 사용하고 통신은 호스트의 승인된 API에 맡기세요. 패널 CSS는 앱 DOM에 주입되지 않습니다.

### 테마

`contributes.themes`의 각 항목은 `{ id, title, base: 'light' 또는 'dark', tokens }`입니다. 허용 토큰은 `--bg-app`, `--bg-surface`, `--bg-raised`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--on-accent`, `--border-subtle`, `--border-strong`입니다. 모두 필수이며 6자리 HEX 색만 받습니다. 텍스트·강조색과 표면, 강조 버튼 글자의 대비는 4.5:1 이상이어야 합니다. 선택 배경은 강조색에서 앱이 계산합니다.

활성화한 테마는 설정 → 외형에서 선택합니다. 비활성화·삭제하면 토큰을 제거하고 기본 테마로 돌아갑니다. 임의 CSS, 외부 URL, 앱 DOM 조작, 편집기 구문/블록 렌더러 교체는 지원하지 않습니다.

## 예제

| 폴더 | 확인할 기능 |
| --- | --- |
| [`word-count`](../examples/plugins/word-count) | 기존 v1 호환, 명령, 필기 조회, 패널 메시지 |
| [`selection-tools`](../examples/plugins/selection-tools) | 설정, 편집 메뉴, 선택 수정, 실행 취소 |
| [`material-summary`](../examples/plugins/material-summary) | 자료 메뉴, 자료 읽기, 패널 복원·닫기 |
| [`study-theme`](../examples/plugins/study-theme) | 대비 검증 토큰 테마와 비활성화 시 복귀 |

## 격리·업데이트·제한

플러그인마다 별도 utility process를 사용합니다. 한 플러그인의 종료·시간 초과는 다른 호스트를 종료하지 않습니다. 메인 브로커는 프로세스에 배정된 ID와 승인 권한, 메시지 크기, 호출 빈도를 확인합니다. 호스트는 제한된 환경변수만 상속하며 Node 사전 로드 옵션이나 앱 API 키 환경변수를 상속하지 않습니다. V8 old-space 한도는 128 MiB입니다(전체 OS 메모리 한도는 아닙니다).

**프로세스 분리와 `node:vm`은 악성 코드에 대한 OS 보안 샌드박스를 보장하지 않습니다.** 플러그인에는 Node/Electron API를 제공하지 않지만 VM 탈출 취약점까지 안전하다고 가정하면 안 됩니다. 심사를 거쳐도 신뢰하는 개발자의 코드만 실행하세요. 승인된 기능의 오용도 가능하므로 최소 권한을 검토해야 합니다.

설치는 검증된 복사본을 사용합니다. 매니페스트·메인·패널 자산의 변경은 재승인을 요구합니다. 기존 다중 파일 v1 설치도 강화된 해시 때문에 한 번 재승인할 수 있습니다. 레지스트리 저장 실패 시 이전 폴더와 승인 상태를 복원합니다. 전원 차단까지 파일시스템 전체 트랜잭션으로 보장하지는 않으므로 복구 시 남은 `.previous` 폴더와 `plugins.json`을 먼저 백업하세요.

네트워크는 정확한 HTTPS 호스트만 허용하며 와일드카드·임의 포트·HTTP를 허용하지 않습니다. RPC 기본 1 MiB, 패널 메시지 64 KiB 제한입니다. 활성화·명령·API에는 시간·호출 빈도 제한이 있습니다. 브라우저 탭 제어, VS Code/Obsidian 런타임 호환, 결제, 평점·댓글은 범위 밖입니다.
