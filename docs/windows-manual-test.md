# Windows 수동 시험

2026-11-03 작성, main 기준. 세 부분이다.

- **1부: 11/10 릴리스.** 로그인 선택화, 자료 폴더 옮기기, Gmail 버튼. 릴리스 전에 한다.
- **2부: 동기화(Google Drive).** 동기화 출시 전에 한다. Windows에는 iCloud가 없다.
- **3부: 릴리스 뒤.** 11/10 공개 뒤의 자동 업데이트와 새 설치.

결과는 항목 번호로 알려 준다(예: "W1-1~W1-7 통과, W2-5 실패"). 실패하면 화면 사진과 설정 › 고급 › [로그 폴더 열기]의 로그를 같이 준다.

릴리스 워크플로가 Windows 설치본에서 돌리는 E2E와 단위 검사는 되풀이하지 않는다. 실제 계정·자료·브라우저·Windows 파일 시스템이 걸린 것만 본다. Mac에서 한 Drive 시험은 설계 문서 24.8에 있다.

## 0. 준비

### 0.1 시험 빌드

릴리스를 만들지 않고 설치 파일을 만든다. Mac 터미널에서 실행한다.

```sh
SHA=$(gh api repos/seojune662/bandal/commits/main -q .sha)
gh workflow run verify-windows-package.yml --ref main -f source_sha=$SHA -f suite=manual-test
gh run list -w verify-windows-package.yml -L 1
```

- 끝나면 Windows PC에서 GitHub에 로그인해 Actions › Verify targeted Windows package › 그 실행 › Artifacts의 `windows-manual-test-<SHA>`를 내려받아 푼다. 안에 `Bandal-Setup.exe`가 있다. 7일 동안 받을 수 있다.
- 릴리스 빌드와 같은 공개 클라이언트 설정(Supabase, Google 데스크톱 클라이언트)이 들어간다. 그래서 로그인과 Drive 연결이 된다.
- 공개 설치 파일처럼 서명이 없다. "Windows의 PC 보호"가 뜨면 [추가 정보] → [실행].
- 버전이 공개판과 같은 0.92.9라 앱에서는 둘을 구분할 수 없다. 어느 커밋인지는 함께 받은 `windows-package-source.json`에 있다.

### 0.2 준비물

- Windows 10 또는 11(x64). 실제 자료를 건드리지 않도록 시험용 Windows 사용자 계정을 따로 만들어 쓴다.
- 공개 v0.92.9 설치 파일: <https://github.com/seojune662/bandal/releases/download/v0.92.9/Bandal-Setup.exe>
- PDF 두 개: 한글 이름인 것, 50 MB가 넘는 것.
- 2부: 같은 Google 계정으로 Drive와 동기화하고 있는 Mac(main 빌드, `BANDAL_SYNC_UI=1`). iPad는 W2-11에서 쓴다.

### 0.3 실행

창을 모두 닫으면 반달이 끝난다. 미니 플레이어가 떠 있으면 그것도 닫는다.

```powershell
# 1부: 기본 프로필. 시작 메뉴에서 열어도 같다.
& "$env:LOCALAPPDATA\Programs\Bandal\Bandal.exe"

# 2부: 동기화 시험 프로필. 이 PowerShell 창에서 연 반달에만 적용된다.
$env:BANDAL_SYNC_UI = '1'
$env:BANDAL_USER_DATA_DIR = "$env:APPDATA\bandal-synctest"
& "$env:LOCALAPPDATA\Programs\Bandal\Bandal.exe"
```

- 반달 로그인은 기본 프로필에서만 시험한다. 로그인 뒤 브라우저가 `bandal://`로 Bandal.exe를 다시 띄우는데, 이때는 환경 변수가 없어 결과가 기본 프로필로 간다.
- Drive 연결은 `bandal://`이 아니라 127.0.0.1로 돌아온다. 그래서 시험 프로필에서도 된다.

| 무엇 | 경로 |
|---|---|
| 설치 | `%LOCALAPPDATA%\Programs\Bandal` |
| 기본 프로필 | `%APPDATA%\bandal`(자료는 그 안의 `Courses`) |
| v0.92.9의 자료 | `%USERPROFILE%\Documents\Bandal` |
| 동기화 시험 프로필 | `%APPDATA%\bandal-synctest` |

## 1부. 11/10 릴리스 (기본 프로필, 플래그 없음)

**W1-1 v0.92.9 사용자 만들기**
1. 공개 v0.92.9를 설치하고 연다. "반달에 로그인"에서 Google로 로그인하고 [이 계정에 연결하고 시작]을 누른다.
2. 과목 둘(한글 이름, 공백이 든 영문 이름)을 만든다. PDF 두 개를 넣고 두 쪽에 필기한다. 노트를 하나 쓴다.
3. 메일 위젯에서 Gmail을 연결한다(W1-6에 쓴다).
4. 반달을 끝내고 `%USERPROFILE%\Documents\Bandal`에 과목 폴더가 생겼는지 본다.

**W1-2 시험 빌드 덮어 설치**
- `Bandal-Setup.exe`를 실행한다. 관리자 권한(UAC)을 묻지 않는지, 설치 폴더를 고를 수 있고 기본값이 `%LOCALAPPDATA%\Programs\Bandal`인지.
- 바탕 화면과 시작 메뉴의 "Bandal"로 열리는지.

**W1-3 자료 폴더 옮기기**
1. 처음 열면 "자료 폴더를 옮길게요"가 뜨는지. 새 위치가 `C:\Users\<사용자>\AppData\Roaming\bandal\Courses`, 원래 폴더가 `C:\Users\<사용자>\Documents\Bandal`로 나오는지.
2. [나중에]를 누른다. 원래 위치 그대로 모든 과목이 열리는지. 반달을 끝내고 다시 열면 또 묻는지.
3. [옮기기]를 누른다. 작업 표시줄 아이콘에 진행이 보이고 "자료 폴더를 옮겼어요"가 뜨는지. [원래 폴더 보기]가 탐색기에서 원래 폴더를 여는지.
4. 확인할 것
   - 과목, PDF 두 개, 필기, 노트가 모두 그대로 열린다.
   - 설정 › 고급 › 워크스페이스가 새 위치를 가리킨다.
   - `%APPDATA%\bandal`에 `Courses`가 있고 `Courses.partial`과 `data-root-migration.json`은 없다.
   - 원래 폴더의 파일이 그대로 있다.
5. **중단**: 1 GB쯤 되는 PDF를 넣어 W1-1부터 다시 한다. [옮기기] 뒤 진행 중에 작업 관리자에서 Bandal을 끝낸다. 다시 열면 또 묻고, 이번에는 끝까지 옮겨지는지. 과목이 두 번 생기거나 원래 폴더가 바뀌면 안 된다.
6. **백신**: V3나 알약이 깔린 PC가 있으면 거기서 한 번 더 한다. 백신이 새로 복사한 파일을 검사하는 동안 폴더 이름 바꾸기가 거부될 수 있다. 그러면 "자료 폴더를 옮기지 못했어요"가 뜨고 원래 위치를 그대로 써야 한다. 다음에 열 때 다시 묻는다.

**W1-4 로그인 없이 쓰기**
- W1-1의 로그인이 이어져 있는지.
- 설정 › 계정에서 로그아웃한다. 로그인 화면이 막지 않고 자료가 그대로 열리는지. 과목 만들기, PDF 넣기, 필기, 노트가 되는지. v0.92.9에서는 여기서 로그인 화면이 막았다.
- 로그인 버튼이 [Apple로 로그인], [Google로 로그인] 둘뿐이고 Kakao가 없는지.

**W1-5 브라우저 로그인과 `bandal://`**
- [Google로 로그인] → 기본 브라우저에서 로그인한다. 브라우저가 Bandal을 열지 물으면 허용한다. 반달이 로그인 상태가 되는지. Apple로도 한 번.
- 기본 브라우저를 Edge와 Chrome으로 바꿔 가며 한 번씩.
- PowerShell에서 `reg query HKCU\Software\Classes\bandal\shell\open\command`. 값이 `"…\AppData\Local\Programs\Bandal\Bandal.exe" "%1"`인지. 설치 프로그램은 `bandal://`을 등록하지 않고, 반달이 열릴 때마다 등록한다.

**W1-6 Gmail 버튼과 숨긴 화면**
- 메일 위젯에 Gmail 받은편지함 대신 [웹메일]이 있는지.
- 설정 › 위젯에 [Google 메일 연결 해제]가 보이는지(W1-1에서 연결했다). 누르면 버튼이 사라지고 `%APPDATA%\bandal\gmail\session.enc`가 없어지는지.
- 설정에 동기화 항목이 없고, 구독·결제 화면이 어디에도 없는지.

**W1-7 제거와 다시 설치**
- 설정 › 앱에서 Bandal을 제거한다. `%APPDATA%\bandal`(자료 포함)이 남는지.
- 다시 설치하면 과목과 로그인이 그대로인지. 옮기기를 다시 묻지 않는지.
- 제거하면 `reg query HKCU\Software\Classes\bandal`이 키를 찾지 못하는지. 같은 설치 파일로 덮어 설치할 때(업데이트와 같은 경로)는 키가 남는지.

## 2부. 동기화 (Google Drive, 시험 프로필, `BANDAL_SYNC_UI=1`)

1부의 반달을 끝내고 0.3의 두 번째 방법으로 연다. Mac은 같은 Google 계정으로 Drive와 동기화하고 있어야 한다.

**W2-1 연결**
- 설정 › 동기화에 Google Drive만 있고 iCloud와 저장소 옮기기는 없는지.
- [Google 계정 연결] → 기본 브라우저 → 권한이 "이 앱으로 만든 Google Drive 파일" 하나인지 → 반달로 돌아와 계정 주소가 보이는지.
- Windows 방화벽 창이 뜨지 않는지. 반달은 127.0.0.1에서만 기다린다.
- `%APPDATA%\bandal-synctest\sync\gdrive-token.enc`가 생기는지. 메모장으로 열어 토큰 글자가 읽히지 않는지(Windows 계정 암호화).
- 반달을 끝내고 다시 열어도 연결이 이어지는지.

**W2-2 받기와 기기 이름**
- [Google Drive에 연결] → "Google Drive의 과목 N개, 문서 M개를 이 기기로 받습니다." → [시작].
- 과목, PDF, 필기, 노트가 Mac과 같은지. 파일은 `%APPDATA%\bandal-synctest\Courses` 아래에 생긴다.
- 기기 카드에 "<PC 이름> (이 기기)"가, Mac은 "N분 전"과 함께 보이는지.
- [이 기기 이름]을 바꾸면 Mac의 기기 카드에 새 이름이 보이는지.

**W2-3 Windows가 못 쓰는 이름**

Mac에서 아래 이름을 만들고 Windows에서 본다.

| Mac에서 만든 이름 | Windows의 이름 |
|---|---|
| 과목 `CON` | `_CON` |
| 과목 안 폴더 `aux` | `_aux` |
| PDF `COM1.pdf` | `_COM1.pdf` |
| 노트 `왜?` | `왜？`(전각 물음표) |
| 폴더 `끝.` | `끝` |

- 모두 받아지고 열리는지. Mac 쪽 이름은 그대로인지. Windows가 바꾼 이름이 Mac으로 되돌아가면 안 된다.
- Windows에서 `_CON`의 노트를 고치면 Mac의 `CON`에 반영되는지.
- Mac에서 과목 `math`를 `Math`로(대소문자만) 바꾸면 Windows 폴더 이름도 바뀌는지.
- Mac에서 만든 한글 이름이 Windows에서 자모로 풀려 보이지 않는지.
- iPad가 있으면 같은 폴더에 노트 `Report`와 `report`를 만든다. Windows에 둘 다 있고 한쪽 이름 뒤에 ` (id 앞 4자)`가 붙는지. 이 이름은 모든 기기에서 같아야 한다.

**W2-4 필기와 노트 왕복**
- Windows에서 필기한다. Mac 창에 포커스를 두면 30초 안에, 창을 클릭하면 곧바로 보이는지. 반대 방향도.
- 반달을 최소화하고 5분 넘게 두는 동안 Mac에서 고친다. 5분 안에 들어오는지, 창을 누르면 곧바로 들어오는지.

**W2-5 잠긴 파일**
- Windows에서 동기화된 PDF 두 개를 Acrobat Reader(또는 Edge)로 열어 둔다.
- Mac에서 하나는 이름을 바꾸고 하나는 지운다.
- 열려 있는 동안 반달이 멈추거나 사본을 만들지 않는지. Acrobat을 닫으면 다음 확인(창을 누르면 곧바로)에 이름 바꾸기와 지우기가 반영되는지.
- Mac에서 열려 있는 PDF에 필기하면 Windows 반달에 보이는지. PDF 파일 자체는 그대로인지(크기와 수정한 날짜).

**W2-6 오프라인과 절전**
- 비행기 모드에서 필기한다. "인터넷 연결을 확인해 주세요"가 뜨고, 비행기 모드를 끄면 이어서 올라가는지.
- 절전(덮개 닫기)으로 10분 넘게 두는 동안 Mac에서 고친다. 깨운 뒤 창을 누르면 들어오는지. "연결이 끊겼어요"가 잘못 뜨지 않는지.

**W2-7 큰 PDF와 긴 경로**
- Windows에서 50 MB가 넘는 PDF를 넣는다. Mac에서 열리는지. 반대 방향도.
- Mac에서 과목 안에 이름이 긴 폴더를 여러 겹 만들어 Windows 전체 경로가 260자를 넘게 한다(예: 60자 폴더 4겹과 60자 PDF). Windows에 받아지고 반달에서 열리는지. 탐색기에서 열리지 않는 것은 Windows 한계라 적기만 한다.

**W2-8 연결 해제와 접근 철회**
- Windows에서 [연결 해제]. `sync\gdrive-token.enc`가 없어지는지, Mac 동기화는 이어지는지. 다시 연결한다.
- myaccount.google.com › 보안 › 타사 앱에서 반달 접근을 삭제한다. 다음 확인 때 "Google Drive 연결이 끊겼어요"가 나오고 [다시 연결]로 돌아오는지. 같은 Google 앱 접근을 지운 것이라 Mac도 끊길 수 있다. 그러면 Mac도 다시 연결한다.

**W2-9 저장소 옮기기 알림**
- Mac에서 설정 › 동기화 › 저장소 옮기기로 iCloud로 옮긴다.
- Windows 기기 카드에 "<Mac 이름> · iCloud로 옮김"이 보이는지.
- 배너에 "<Mac 이름>에서 iCloud로 옮겼어요"와 "이 기기에서는 iCloud를 쓸 수 없어 지금처럼 Google Drive와 동기화해요."가 보이고 버튼이 [닫기]뿐인지. 토스트는 뜨지 않는지.
- [닫기] 뒤 반달을 다시 열어도 배너가 나오지 않는지.
- Windows는 Drive와 계속 동기화하지만 Mac과는 더 맞춰지지 않는다(스펙대로). 끝나면 Mac을 Google Drive로 되돌리고 다시 맞춰지는지 본다.

**W2-10 다시 설치**
- 시험 빌드를 제거하고 다시 설치한 뒤 0.3의 두 번째 방법으로 연다.
- 다시 받지 않고 이어지는지. Mac의 기기 카드에 Windows가 둘로 늘지 않는지.

**W2-11 iPad와 (X6)**
- 설계 문서 24.8의 9를 Mac 대신 Windows로 한다. 시작 전에 Drive의 반달 폴더를 모두 휴지통으로 보낸다(Mac도 연결 해제).
- 적어도 두 가지: Windows가 먼저 연결해 만든 루트에 iPad가 들어오기, iPad가 만든 루트에 Windows가 들어오기. 첫 업로드 중 대기 문구("다른 기기(…)가 아직 올리고 있어요")도 본다.

## 3부. 릴리스 뒤 (11/10)

**W3-1 자동 업데이트**
- 공개 v0.92.9만 깔린 Windows PC(W1-1처럼 자료가 있는 것)에서 앱 안내대로 업데이트한다.
- 다시 연 뒤 "자료 폴더를 옮길게요"가 뜨고 W1-3의 확인이 그대로 맞는지.

**W3-2 새 설치**
- 반달을 쓴 적 없는 Windows 계정에서, 웹사이트에서 받은 설치 파일로 설치한다.
- 옮기기를 묻지 않고 열리는지. 새 과목이 `%APPDATA%\bandal\Courses`에 생기는지.
