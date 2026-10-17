# Apple iPad 준비 상태 읽기 검사

`.github/workflows/apple-ipad-readiness.yml`은 `main`에서 수동 실행하는 읽기 전용 검사다. 앱과 구독을 생성하거나 수정하지 않는다. 별도 의존성 설치 없이 Node 24의 암호화 API와 `fetch`를 사용한다.

기존 GitHub Actions secrets `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`는 실제 검사 step의 프로세스 환경에서만 사용한다. 개인키를 파일에 저장하지 않으며, 각 GET마다 메모리에서 ES256 JWT를 만든다. 토큰 수명은 120초이고 `scope`는 해당 요청의 경로와 query 하나로 제한한다. `APPLE_TEAM_ID`는 JWT issuer가 아니므로 이 검사에 사용하지 않는다.

고정 대상은 앱 `app.bandal.ipad`와 구독 상품 `app.bandal.ipad.sync.monthly`, `app.bandal.ipad.sync.yearly`다. `https://api.appstoreconnect.apple.com`의 아래 GET만 사용한다. redirect를 거부하고, pagination은 원래 resource/filter를 유지하며 cursor만 변경한다.

- `/v1/apps?filter[bundleId]=app.bandal.ipad`: 앱 존재, production/sandbox 알림 URL의 설정 여부와 버전
- `/v1/bundleIds?filter[identifier]=app.bandal.ipad`: Bundle ID 존재
- `/v1/bundleIds/{id}/bundleIdCapabilities`: In-App Purchase / Sign in with Apple capability가 반환되는지
- `/v1/apps/{id}/subscriptionGroups`: 구독 그룹 존재와 개수
- `/v1/subscriptionGroups/{id}/subscriptions`: 두 상품의 존재·기간·상태

로그와 GitHub step summary에는 고정 식별자, 정해진 상태값과 개수만 출력한다. 키, JWT, 헤더, 원문 응답/오류, 앱 이름, Apple 내부 ID, 서버 URL을 출력하거나 artifact로 업로드하지 않는다. HTTP 401은 `authentication_failed`, 403은 `forbidden`으로 구분한다. 403의 구체적인 원인을 읽기 결과만으로 역할 부족 또는 계약 문제라고 단정하지 않는다. 요청 실패·잘못된 응답·페이지 제한은 `unknown`으로 남기며, 조회 실패를 미등록으로 취급하지 않는다.

성공한 workflow는 **읽기 요청이 완료됐다는 뜻**이다. 앱/상품 미등록은 `missing`으로 보고하며 검사 자체는 성공할 수 있다. 구매 가능 또는 배포 가능을 뜻하지 않는다. 키 누락·잘못된 키·인증 실패·접근 거부·통신/응답 오류는 실패 exit code를 반환한다.

검사로 확인할 수 없는 항목:

- **공증/ASC 관리 키와 App Store Server API용 In-App Purchase 키는 다르다.** 결제 검증용 키는 App Store Connect의 Users and Access → Integrations → In-App Purchase에서 별도로 관리한다. 이 워크플로는 그 키를 생성하거나 확인하지 않는다.
- **신규 앱 record는 App Store Connect 웹에서 등록해야 한다.** 공개 API의 `/v1/apps`에는 생성 POST가 없다. Bundle ID 등록과 구독 그룹·상품 생성은 API가 있지만 이 검사는 호출하지 않는다.
- **Paid Apps Agreement, 세금·은행 정보는 별도 확인 대상이다.** 계약은 Account Holder가 체결하며, sandbox 구매 테스트에도 활성 계약이 필요하다. 공개 API에는 이 검사에서 사용할 계약 상태 조회 endpoint가 없다.
- **GET 성공은 쓰기 권한의 증명이 아니다.** 공증 성공만으로 상품 가격 설정·심사 제출 권한까지 추론하지 않는다. 현재 key의 역할을 직접 조회하는 공개 API도 없다.
- **상품 상태와 알림 URL 존재만으로 실제 결제·알림 전달은 검증되지 않는다.** capability의 `not_listed` 역시 서버 응답에 없다는 뜻이며, 기본 활성 capability가 비활성이라는 단정이 아니다.

비밀값 없이 로컬 검증:

```sh
node --test scripts/test-apple-ipad-readiness.mjs
```

모의 fetch와 임시 생성한 테스트 키만 사용한다. 실제 Apple API와 GitHub secrets에는 접근하지 않는다. 이 workflow 추가 이후 수동 실행은 보안 검토 후 진행한다.

공식 근거(2026-10-17 확인): [API 키와 역할](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api), [JWT 수명과 GET scope](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests), [Apps API의 신규 앱 제한](https://developer.apple.com/documentation/appstoreconnectapi/apps), [공식 OpenAPI 명세](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip), [구독 생성](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptions), [별도 결제 서버 키](https://developer.apple.com/documentation/appstoreserverapi/creating-api-keys-to-authorize-api-requests), [계약과 구매 테스트 요건](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/).
