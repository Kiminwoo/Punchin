# iPhone · Android 개발

## 구성

직원 앱은 React 화면을 Capacitor 네이티브 WebView로 실행합니다. `apps/employee/android`와 `apps/employee/ios`에 기본 프로젝트를 생성했습니다. 앱 ID `com.punchin.employee`는 개발용 예시이며, 배포 전 회사 소유 식별자로 확정해야 합니다.

생성된 네이티브 프로젝트만으로 앱 심사·설치 검증이 완료된 것은 아닙니다. 이 환경에서는 웹 빌드·Chromium 테스트·네이티브 프로젝트 생성/웹 에셋 동기화만 검증합니다.

## Android

Android Studio와 Capacitor 8에 맞는 Android SDK·JDK를 설치한 환경에서 실행합니다.

```bash
pnpm --filter @punchin/employee native:android
```

이 명령은 웹 빌드 → Android 프로젝트 동기화 → Android Studio 열기를 수행합니다. Studio에서 에뮬레이터·실제 갤럭시를 선택해 실행합니다. 앱 서명용 keystore와 비밀번호를 Git에 넣지 마세요.

## iOS

Mac, 지원되는 Xcode, Apple 개발자 계정과 서명 설정이 필요합니다.

```bash
pnpm --filter @punchin/employee native:ios
```

웹 빌드 → iOS 프로젝트 동기화 → Xcode 열기를 수행합니다. 생성 프로젝트는 Swift Package Manager 구성을 사용합니다. Xcode에서 회사 Team·Bundle Identifier·Signing을 설정하고 시뮬레이터와 실제 iPhone에서 검증합니다.

네이티브 폴더를 삭제한 경우에만 `native:add:android`, `native:add:ios`로 다시 생성합니다. 기존 프로젝트가 있으면 add 대신 sync를 사용합니다.

## 서버 연결 전 추가할 작업

- 실제 로그인과 토큰의 Keychain·Keystore 보관.
- 사용 중 위치 권한 설명·정밀 위치 거부·권한 철회·위치 실패 처리.
- 위치 측정값과 서버의 판정, 실패 시 대체 신청.
- 알림 권한·FCM/APNs·기기 토큰·로그아웃 시 토큰 해제.
- Android 뒤로 가기와 앱 복귀·재시작 동작.
- CSV 다운로드의 네이티브 파일 저장·공유 어댑터. 현재 CSV는 웹 다운로드만 검증됨.
- iOS/Android 글자 크기·VoiceOver/TalkBack·노치·키보드·safe-area.
- 개인정보 고지·스토어 신고·테스트 계정·회사 배포 방식.

관리자 웹은 네이티브 앱에 포함하지 않습니다. 시연 모드 구분은 권한 보안이 아니며, 실제 관리자 권한은 서버가 검증해야 합니다.

## 서버 연결 단계의 현재 제한

웹 직원/관리자 앱은 기본적으로 로그인 후 실제 API를 사용합니다. `/api` 상대 경로와 HttpOnly 쿠키를 사용하므로 개발 Vite 프록시 또는 운영의 같은 Origin 리버스 프록시가 필요합니다. 이 설정을 Capacitor 앱의 원격 서버 인증으로 간주하면 안 됩니다.

네이티브 앱에는 회사 HTTPS API 주소와 네이티브용 세션 전송/쿠키 처리 또는 토큰·Keychain/Keystore 어댑터를 확정해 연결해야 합니다. 현재 네이티브 프로젝트는 생성·동기화만 했으며, 설치형 앱에서 로그인·GPS가 동작한다고 검증하지 않았습니다. 서명·스토어 배포는 이 연결과 실제 기기 테스트 뒤 진행합니다. 현재 단계의 통합 검증은 브라우저에서 수행합니다.
