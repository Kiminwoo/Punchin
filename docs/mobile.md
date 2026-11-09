# iPhone · Android 앱

직원 앱은 React 화면을 Capacitor 8의 네이티브 WebView로 실행합니다. Android 프로젝트와 iOS Xcode 프로젝트를 저장소에서 관리합니다. 관리자 화면은 웹입니다.

## 구현된 연결

- 브라우저: 같은 Origin API 프록시와 HttpOnly 쿠키.
- 네이티브: 빌드에 고정한 HTTPS Origin, CapacitorHttp, 별도 모바일 인증 경로, bearer 세션.
- iPhone: Keychain, WhenUnlockedThisDeviceOnly, iCloud 동기화 제외.
- Android: Android Keystore AES-GCM 키로 암호화하고 앱 전용 저장소에 보관, 앱 백업 제외.
- 세션 만료·퇴사·로그아웃: 서버에서 회수하고 네이티브 저장소에서 제거. 보관 실패 시 평문 저장으로 대체하지 않음.
- 위치: 공식 Geolocation 플러그인, 사용 중 권한만 요청. 상시 위치 추적·백그라운드 권한 없음.
- CSV: 사용자 요청 시 임시 캐시 파일과 네이티브 공유 시트 사용, 공유 후 캐시 제거 시도.
- iOS 위치 설명과 FileTimestamp 개인정보 매니페스트 추가.

## 실제 서버 주소

회사 HTTPS 서버를 정한 뒤 `apps/employee/.env.production.local`에 공개 Origin만 설정합니다.

```dotenv
VITE_API_BASE_URL=https://attendance.your-company-domain
```

비밀번호·MFA 보관 키 등 비밀값은 VITE_ 변수에 넣지 않습니다. 경로·계정·쿼리가 포함된 URL과 HTTP는 거부합니다. 네이티브 전용 빌드는 주소가 없으면 실패합니다.

```bash
pnpm --filter @punchin/employee native:android
pnpm --filter @punchin/employee native:ios
```

각 명령은 네이티브용 웹 빌드 → 프로젝트 동기화 → Android Studio 또는 Xcode 열기를 수행합니다. Android는 JDK 21·SDK 36, iOS는 Mac·Xcode 26 이상이 필요합니다. 앱 ID `com.punchin.employee`는 개발용이며 배포 전 회사 식별자로 확정합니다.

## 자동 검증과 실기기 검증

`Native build checks`는 GitHub Actions에서 Android Debug 빌드/유닛 검사와 서명 없는 iOS 시뮬레이터 빌드를 수행합니다. CI 주소는 `https://attendance.example.invalid`로, 컴파일 확인용 앱이며 회사 사용용 빌드가 아닙니다. CI 통과 여부와 실기기 설치·동작 여부는 구분합니다.

실제 iPhone·갤럭시에서 로그인 유지, 화면 잠금/복귀, 로그아웃, 앱 재시작, 세션 회수, GPS 허용/거부/정밀 위치, 사무실 내 오차, 파일 공유, 글자 크기·VoiceOver/TalkBack, 노치·키보드·뒤로 가기를 확인해야 합니다. 현재 개발 환경에는 Mac/Xcode와 연결된 실제 휴대폰이 없습니다. 스토어 업로드·회사 서명·TestFlight·Play 테스트 배포는 수행하지 않았습니다.

인증 세션은 현재 8시간 만료이며 이후 재로그인이 필요합니다. 기기 자체 잠금이 없는 환경이나 루팅·탈옥 환경의 안전성을 보장하는 구현은 아닙니다. 설치형 앱 배포 전에 사내 기기 정책과 함께 검토합니다.

공식 기준: [Capacitor 8 환경](https://capacitorjs.com/docs/getting-started/environment-setup), [Android Keystore](https://developer.android.com/privacy-and-security/keystore), [Apple Keychain 접근성](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly).
