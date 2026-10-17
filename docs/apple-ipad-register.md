# 고정 iPad Bundle ID 등록 도구

`.github/workflows/apple-ipad-register.yml`은 검토된 `main`에서 수동 실행한다. 대상은 `app.bandal.ipad`, 이름 `Bandal iPad`, platform `IOS`이며 변경 입력을 받지 않는다. 기존 `apple-ipad-readiness.yml`과 그 스크립트는 계속 조회 전용이다.

이 도구의 쓰기는 두 가지뿐이다.

1. 정확한 Bundle ID를 GET으로 조회해 없을 때만 `POST /v1/bundleIds`로 등록한다.
2. 그 Bundle ID에서 Sign in with Apple capability가 없을 때만 `POST /v1/bundleIdCapabilities`로 `APPLE_ID_AUTH`를 활성화한다. 새 앱의 primary 설정은 `APPLE_ID_AUTH_APP_CONSENT` → `PRIMARY_APP_CONSENT`, `enabled: true`다.

각 생성 응답과 후속 GET에서 내부 resource ID와 설정을 다시 확인한다. 기존 등록의 identifier·name·platform·seedId가 모두 맞으면 재사용한다. 기존 Apple 로그인 설정이 primary와 다르거나 응답이 중복·불완전하면 중단한다. 이름 변경, 앱 그룹 연결, PATCH, DELETE, 앱 record·상품·키 생성, 계약 동의는 수행하지 않는다.

2026-10-17 실제 API는 `IOS` 생성 요청을 `UNIVERSAL`로 반환했다. identifier·name·seedId는 요청과 일치했다. Apple의 [BundleIdPlatform 정의](https://developer.apple.com/documentation/appstoreconnectapi/bundleidplatform)에 따라 iOS를 포함하는 `UNIVERSAL`도 조회·후속 검증에서 허용한다. 생성 요청은 계속 `IOS`이며 `MAC_OS`나 알 수 없는 플랫폼은 거절한다. 이는 다른 플랫폼의 App Store 앱 record를 추가하지 않는다.

`APPLE_TEAM_ID`는 메모리에서 `VUZ7Z98BW3`와 정확히 비교한다. 생성 요청의 `seedId`도 이 값으로 고정하며, 기존·생성·검증 응답에서 같은 prefix인지 확인한다. 설정값이나 서버가 돌려준 내부 ID는 로그에 출력하지 않는다. 다만 **이 비교는 JWT issuer가 어느 팀 소유인지 독립적으로 조회하는 검증은 아니다.** 공개 API의 `seedId` 필드는 App ID prefix이며, 기존 팀은 Team ID와 다른 prefix를 가질 수도 있다. 이 도구는 요청된 고정 prefix만 허용한다. 공식 문서는 `seedId`를 설정할 수 있다고 명시하지만, 다른 팀 prefix 거절 동작을 독립적인 팀 인증 수단으로 보장하지 않으므로 그런 주장을 하지 않는다. API 인증과 역할 권한 검사는 Apple 서버가 수행한다.

GitHub Actions secrets `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`는 등록 step의 프로세스 환경에만 전달한다. 개인키·JWT를 파일, 로그, artifact에 저장하지 않는다. Node 표준 라이브러리로 매 요청마다 120초 ES256 JWT를 만들고, 공식 `https://api.appstoreconnect.apple.com`만 호출하며 redirect를 거부한다. 원격 응답의 링크는 따라가지 않는다.

Apple 공식 JWT 문서의 `scope`는 **GET 요청**을 대상으로 한다. GET은 정확한 경로와 query scope를 사용한다. POST는 scope 없는 짧은 토큰을 키 역할 범위에서 사용하며, 클라이언트 코드가 위 두 고정 POST와 payload만 만들도록 제한한다. POST 토큰 자체가 한 endpoint로 암호학적으로 제한된다고 주장하지 않는다.

401은 `authentication_failed`, 403은 `forbidden`으로 구분해 즉시 종료한다. 403을 역할 부족 또는 계약 문제 중 하나로 단정하거나 반복 요청·다른 키로 우회하지 않는다. 409, 통신 오류, 불완전한 검증도 중단하며 자동 재시도하지 않는다. POST 응답을 받지 못한 경우 생성 여부가 불확실하므로 `write_outcome_unknown`과 `unverified_after_write`를 보고한다. 수동 재실행은 먼저 GET을 수행하므로 정확히 일치하는 앞선 생성 결과를 재사용할 수 있다. 이미 성공한 등록을 지워 되돌리지 않는다.

완료 JSON은 Bundle ID와 capability를 검증했다는 뜻이다. 앱 배포나 결제가 준비됐다는 뜻은 아니다. 로그와 step summary에는 고정 대상과 정의된 상태값만 기록한다. 모든 local 검사는 모의 fetch와 임시 테스트 키로 실행한다.

```sh
node --test scripts/test-apple-ipad-register.mjs
```

남은 웹·배포 절차:

1. App Store Connect에서 올바른 팀을 선택하고 **Apps → + → New App**으로 iOS 앱 record를 만든다. 이름, 기본 언어, SKU, 접근 권한을 입력하고 Bundle ID `app.bandal.ipad`를 선택한다. 신규 앱 record를 만드는 공개 `/v1/apps` POST는 없다. 필요한 역할은 Account Holder, Admin 또는 App Manager이며, App Manager의 접근 범위도 확인한다.
2. Account Holder가 필요한 최신 계약과 Paid Apps Agreement를 확인하고 세금·은행 정보를 완료한다. 이 도구는 계약에 동의하지 않는다.
3. 구독 그룹과 월·연 상품의 메타데이터·가격·판매 지역·심사 정보를 별도로 구성한다. 기존 공증/ASC API 키는 결제 검증용 **In-App Purchase 서버 키**가 아니다. 해당 키 및 서버 알림 설정은 별도다. 웹 Apple OAuth를 사용할 경우 Services ID·return URL·로그인용 키 설정도 별도다.
4. Xcode에서 같은 개발팀과 Bundle ID, Sign in with Apple entitlement를 사용하고 변경된 capability를 포함하는 배포 provisioning profile을 준비한다. 실제 기기 로그인, StoreKit sandbox 구매·복원, TestFlight 빌드 및 심사 절차를 검증한다.

공식 근거(2026-10-17 확인): [Bundle ID 등록 API](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleids), [Capability 활성화 API](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleidcapabilities), [공식 OpenAPI 명세](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip), [JWT와 GET scope](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests), [새 앱의 primary Apple 로그인 설정](https://developer.apple.com/help/account/capabilities/about-sign-in-with-apple/), [App ID prefix와 Team ID](https://developer.apple.com/library/archive/technotes/tn2311/_index.html), [새 앱 record 등록](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/), [별도 결제 서버 키](https://developer.apple.com/documentation/appstoreserverapi/creating-api-keys-to-authorize-api-requests).
