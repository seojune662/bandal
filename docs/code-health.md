# 코드 건강 기준

이 문서는 시점이 고정된 감사 백로그 대신 저장소가 계속 지켜야 할 기준을 기록한다.
제품 과제와 릴리스 작업은 이 문서에 쌓지 않고 이슈 트래커에서 관리한다.

## 필수 검사

```bash
pnpm typecheck
pnpm deadcode
pnpm test
pnpm build
pnpm e2e
```

- TypeScript는 main과 renderer 모두 `noUnusedLocals`와
  `noUnusedParameters`를 적용한다. 인터페이스 때문에 받지만 쓰지 않는 매개변수는
  `_` 접두사를 붙인다.
- Knip은 미사용 파일, export, dependency와 중복 export를 검사한다. 새 예외는
  정적 분석으로 표현할 수 없는 실제 진입점이나 동적 로딩 경로에만 추가한다.
- CI와 릴리스 검증은 `typecheck` 다음에 `deadcode`를 실행한다.

## Knip 예외

- `brandMark.ts`와 선언 파일은 같은 이름의 ESM 구현을 TypeScript와 Node 양쪽에서
  공유하는 어댑터라 확장자 해석만으로는 사용 관계를 판별할 수 없다.
- `better-sqlite3-node`는 테스트가 `createRequire`로 동적 로딩한다.
- `@milkdown/exception`은 Milkdown 패키지들의 모듈 인스턴스를 같은 버전으로
  고정하기 위한 직접 의존성이다.
- `iconutil`과 `where.exe`는 운영체제에서 제공하는 외부 명령이다.
## 삭제와 호환 원칙

- 화면과 runtime 진입점에서 도달할 수 없고 Git 이력상 교체된 구현은 전용 CSS와
  테스트까지 함께 삭제한다.
- 적용된 DB migration은 수정하거나 삭제하지 않는다.
- 이전 릴리스의 사용자 데이터, 창 위치와 브라우저 세션을 읽는 변환 코드는 지원
  버전 정책이 바뀌기 전까지 유지한다.
- 코드 모양만 비슷한 UI는 합치지 않는다. 같은 데이터 규칙이 두 곳에서 독립적으로
  검증되는 경우처럼 변경 이유가 같은 로직만 공통화한다.
