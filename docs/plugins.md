# Bandal 플러그인

새 기능과 개발·배포 절차는 [플러그인 API v2](plugins-v2.md)를 참고하세요. 아래는 계속 지원되는 v1 기본 API의 설명입니다. v2는 같은 기본 API에 설정 스키마·메뉴·선택 편집·테마를 추가합니다.

Bandal 플러그인은 하나의 폴더에 매니페스트, CommonJS 호스트 코드, 선택적인 패널 UI를 담는 확장입니다. 호스트 코드는 메인 프로세스나 렌더러가 아닌 전용 플러그인 호스트 프로세스에서 실행되고, 승인된 API만 RPC로 호출할 수 있습니다.

필드 이름 일부는 Obsidian 매니페스트와 비슷하지만 API와 실행 환경은 별개입니다. **옵시디언 플러그인은 로드되지 않습니다(필드명만 호환).**

## 폴더 구조

```text
my-plugin/
├── manifest.json
├── main.js
├── styles.css          # 선택 사항, 정확히 이 이름만 허용
└── ui/
    ├── index.html
    └── panel.js
```

`main.js`는 다음 형태의 CommonJS 모듈을 내보냅니다.

```js
module.exports = {
  activate(bandal) {
    bandal.commands.register('hello', async () => {
      await bandal.notices.show('안녕하세요!')
    })
  }
}
```

호스트 전역에는 `module`, `exports`, `console`, 타이머, `URL`, `TextEncoder`, `TextDecoder`, `structuredClone`, 동결된 `bandal` 객체만 제공됩니다. Node의 `require`, `process`, Electron API는 플러그인 API가 아닙니다.

## 매니페스트

```json
{
  "manifestVersion": 1,
  "id": "publisher.my-plugin",
  "name": "내 플러그인",
  "version": "1.0.0",
  "minAppVersion": "0.36.0",
  "description": "플러그인이 하는 일을 설명합니다.",
  "author": "작성자",
  "main": "main.js",
  "permissions": ["commands", "notices"],
  "contributes": {
    "commands": [
      { "id": "hello", "title": "인사하기", "defaultChord": null }
    ],
    "panels": [
      { "id": "summary", "title": "요약", "entry": "index.html" }
    ]
  },
  "styles": "styles.css"
}
```

필드 규칙은 다음과 같습니다.

- `manifestVersion`: v1에서는 반드시 `1`입니다.
- `id`: 소문자 영숫자와 하이픈으로 된 점 구분 식별자입니다. 각 구간은 영숫자로 시작하며 전체 길이는 128자 이하입니다. 설치 뒤에는 바꾸지 마세요.
- `name`, `description`, `author`: 각각 최대 40자, 300자, 80자입니다.
- `version`, `minAppVersion`: SemVer 문자열입니다.
- `main`: 플러그인 폴더 안의 단일 진입 파일입니다. 일반적으로 `main.js`를 사용합니다. 절대 경로, `..`, 역슬래시, NUL은 허용되지 않습니다.
- `permissions`: 설치·업데이트 뒤 사용자가 검토하고 승인할 권한입니다. 알 수 없는 권한은 경고와 함께 제거됩니다.
- `contributes.commands`: 최대 32개입니다. `id`는 소문자 영숫자로 시작하고 이후 소문자 영숫자·하이픈을 쓸 수 있으며 최대 48자입니다. `defaultChord`는 단축키 문자열 또는 `null`입니다.
- `contributes.panels`: 최대 4개입니다. `entry`는 `ui/` 기준 상대 경로이며 절대 경로, `..`, 역슬래시, NUL을 쓸 수 없습니다.
- `styles`: 패널에만 적용되는 루트 `styles.css`를 사용하려면 `"styles.css"`, 사용하지 않으면 `null`입니다.

`menus`와 `themes` 키는 v1에서 경고 후 무시됩니다. 설치 폴더는 파일 200개와 전체 20 MiB 제한을 받으며, `manifest.json`은 32 KiB, 메인 파일은 2 MiB 이하여야 합니다. dotfile, 심볼릭 링크, 실행 파일처럼 허용되지 않은 확장자가 하나라도 있으면 설치를 거절합니다.

## 권한

모든 호출은 메인 프로세스의 브로커에서 다시 검사됩니다. 매니페스트가 새 권한을 요청하거나 승인된 실행 코드가 달라지면 다시 승인이 필요합니다.

| 권한 | 허용 기능 |
| --- | --- |
| `courses.read` | 과목 목록과 현재 과목 읽기 |
| `notes.read` | 필기 목록과 내용 읽기 |
| `notes.write` | 필기 만들기와 수정하기 |
| `materials.read` | 자료 목록과 텍스트 자료 읽기 |
| `commands` | 명령 등록 |
| `panel` | 패널 열기와 패널 메시지 송수신 |
| `notices` | Bandal 알림 표시 |
| `settings` | 해당 플러그인의 설정 읽기와 저장 |
| `events` | `note:saved`, `course:changed` 이벤트 구독 |
| `net:<hostname>` | 지정한 정확한 호스트로 HTTPS 요청 |

네트워크 권한의 호스트는 소문자로 정규화됩니다. 예를 들어 `net:api.example.com`은 `https://api.example.com/path`만 허용합니다. HTTP, 포트가 붙은 URL, 하위 도메인, 경로를 포함한 권한, `*` 와일드카드는 허용되지 않습니다.

## `bandal` API

API 메서드는 별도 표기가 없으면 Promise를 반환합니다. 실제 과목·필기·자료 객체는 Bandal이 반환한 불투명한 데이터로 취급하고, 필요한 필드만 읽는 편이 이후 버전과 호환하기 좋습니다.

### 명령

```js
bandal.commands.register(commandId, handler)
```

매니페스트의 `contributes.commands`에 선언한 명령의 핸들러를 등록합니다. 사용자가 명령을 실행하면 `handler()`의 완료 또는 오류가 호스트를 통해 반환됩니다.

### 과목과 필기

```js
await bandal.courses.list()
await bandal.courses.current()

await bandal.notes.list(courseId)
await bandal.notes.read(noteId)
await bandal.notes.write(noteId, input)
await bandal.notes.create(courseId, input)
```

`courses.*`에는 `courses.read`, 필기 목록·읽기에는 `notes.read`, 만들기·쓰기에는 `notes.write`가 필요합니다. 현재 과목이 없으면 `courses.current()`는 빈 결과를 반환할 수 있습니다.

### 자료

```js
await bandal.materials.list(courseId)
await bandal.materials.readText(courseId, relativePath)
```

두 메서드 모두 `materials.read`가 필요합니다. `readText`는 Bandal이 허용하는 텍스트 자료만 읽으며 임의 파일 시스템 경로를 받지 않습니다.

### 알림과 설정

```js
await bandal.notices.show(message, tone)
await bandal.settings.get(key)
await bandal.settings.set(key, value)
```

`tone`은 생략하거나 `info`, `danger` 중 하나를 사용합니다. 설정은 호출한 플러그인 이름 공간에만 저장되며 전체 직렬화 크기는 256 KiB로 제한됩니다.

### 패널

```js
await bandal.panel.post(panelId, payload)
bandal.panel.onMessage(panelId, handler)
await bandal.panel.open(panelId)
```

호스트에서 `post`로 보낸 값은 패널의 `window.bandal.onMessage(handler)`에 전달됩니다. 패널은 `window.bandal.postMessage(payload)`로 호스트의 `panel.onMessage` 구독자에게 값을 보냅니다.

패널 페이지는 `bandal-plugin://<plugin-id>/ui/...`에서 제공됩니다. 고정 CSP는 같은 플러그인의 스크립트·스타일·이미지·폰트와 `data:` 이미지만 허용하고 네트워크 연결, 프레임 부모, base URL 변경, 폼 제출을 막습니다. 따라서 스크립트는 별도 `.js` 파일로 두어야 하며 인라인 스크립트와 외부 CDN 리소스를 사용할 수 없습니다. 플러그인의 `styles.css`는 플러그인 패널 내부에만 적용됩니다.

### 이벤트

```js
bandal.events.on('note:saved', handler)
bandal.events.on('course:changed', handler)
```

이벤트 수신에는 `events` 권한이 필요합니다. 이벤트 페이로드는 구조화 복제로 전달되므로 함수나 DOM 객체를 넣을 수 없습니다.

### 네트워크

```js
await bandal.fetch('https://api.example.com/data', options)
```

URL 호스트와 정확히 일치하는 `net:api.example.com` 권한이 필요합니다. 요청은 플러그인 호스트가 직접 보내지 않고 메인 프로세스가 시간·응답 크기·호출 빈도 제한을 적용해 대행합니다.

RPC 메시지는 기본 1 MiB, 패널 메시지는 64 KiB로 제한됩니다. API 호출은 일반적으로 10초 안에 끝나야 하며, 전체 API·알림·네트워크 호출에는 각각의 속도 제한이 있습니다.

## 설치

현재 앱은 폴더 설치와 검증된 카탈로그 ZIP 설치를 지원합니다. v1 플러그인도 같은 설치 경로를 사용합니다.

1. 플러그인 폴더에 `manifest.json`과 매니페스트가 가리키는 메인 파일을 둡니다.
2. 설정의 **플러그인** 화면에서 **폴더에서 설치**를 누르고 해당 폴더를 선택합니다.
3. 설치 검사 결과와 요청 권한을 확인합니다.
4. 권한을 승인한 뒤 플러그인을 활성화합니다.
5. 코드를 바꾸거나 권한을 추가했다면 다시 승인하고 다시 로드합니다.

설치 시 Bandal은 폴더 내용을 사용자 데이터 디렉터리로 복사합니다. 개발자 탭에서 개발 폴더를 연결하면 변경을 감지하고 검사 후 갱신합니다. 변경된 코드·자산은 다시 승인해야 합니다.

동작 예시는 [`examples/plugins/word-count`](../examples/plugins/word-count/README.md)에 있습니다.

## 위협 모델

각 플러그인은 별도의 호스트 프로세스에서 실행됩니다. `node:vm`과 프로세스 분리는 악성 코드에 대한 OS 보안 샌드박스를 보장하지 않습니다. 플러그인 API에는 자격증명 저장소·앱 DB·Electron 객체를 제공하지 않지만 VM 탈출 취약점까지 안전하다고 가정하면 안 됩니다. 신뢰하는 개발자의 코드만 실행하세요.

과목·필기·자료·설정 접근과 알림·패널 조작은 모두 메인 프로세스 RPC입니다. 메인 브로커는 플러그인 ID, 승인 권한, 페이로드 크기, 호출 빈도를 매번 검사합니다. 네트워크도 호스트에 소켓 권한을 맡기는 대신 승인된 정확한 HTTPS 호스트로만 메인 프로세스가 대행합니다. 패널은 앱 렌더러와 분리된 전용 스킴과 CSP 안에서 실행됩니다.

이 구조는 실수하거나 악의적인 플러그인의 접근 범위를 줄이지만, 권한을 승인한 기능의 오용까지 막지는 못합니다. 출처와 코드를 확인하고 필요한 최소 권한만 승인하세요.

## v1 범위 밖

다음 기능은 v1에 포함되지 않습니다.

- 에디터 API와 문서 편집기 내부 확장
- 앱 렌더러 DOM 접근
- 앱 전역 테마 주입
- `menus` 기여
- 브라우저 탭 접근 또는 제어
- zip 파일 설치
- 와일드카드 네트워크 권한
- `tab:activated` 이벤트
