# Punchin

20명 이하, 단일 가산 오피스를 위한 사내 근태관리 모노레포입니다. React 직원 앱·관리자 웹이 공통 UI·계산·API 계약을 공유하며, Fastify API와 SQLite 영속 저장소에 연결됩니다.

현재 단계는 **개발 환경에서 인증·기록·요청을 검증할 수 있는 통합 버전**입니다. 실제 회사 계정이나 비밀번호는 포함하지 않습니다. 사무실 주소는 반영했지만 GPS 중심 좌표는 추정하지 않았습니다. 관리자 현장 검증 전에는 위치 인증이 꺼져 있습니다. 네이티브 인증·휴가 원장·월별 마감·MFA·배포 구성을 구현했습니다. 실제 앱 서명·현장 검증·운영 서버 배포는 남아 있습니다.

## 시작

Node.js 24 LTS, pnpm 11.25.0을 사용합니다.

```bash
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
```

`apps/api/.env`를 로컬 편집기로 열고 초기 관리자 이메일·이름·12자 이상 비밀번호를 설정하세요. 비밀번호를 채팅·Git·명령어 기록에 넣지 마세요. 다음 명령은 빈 DB에서 한 번만 동작합니다.

```bash
pnpm bootstrap
# 성공 후 .env에서 ADMIN_PASSWORD를 제거하세요.
pnpm dev:all
```

- 직원 앱: `http://localhost:5173`
- 관리자 웹: `http://localhost:5174`
- API: `http://127.0.0.1:3001/api/health`

별도로 실행하려면 `pnpm dev:api`, `pnpm dev`, `pnpm dev:admin`을 사용하세요. 두 웹 앱의 `/api`는 개발 프록시를 통해 같은 API에 연결됩니다. DB 기본 경로는 `apps/api/data/punchin.sqlite`입니다. 실행 디렉터리가 다른 경우 `DATABASE_PATH`를 절대 경로로 지정하세요.

관리자가 ‘우리 팀 → 직원 초대’에서 일회용 초대 코드를 만들고 직접 전달합니다. 직원은 로그인 화면의 ‘초대 코드로 처음 시작하기’에서 활성화합니다. 실제 이메일은 발송하지 않습니다. 다른 관리자가 본인 요청을 처리하도록 관리자 계정을 2명 이상 지정할 수 있습니다.

## 연결된 기능

- 서버 세션 로그인·로그아웃, 72시간 일회용 초대·재발급, 직원 비활성화와 세션 회수.
- 서버 시각 출퇴근, 요청 키에 의한 재전송 중복 방지, 영속 근태 조회·CSV.
- 휴가·외근·출근/퇴근 정정 요청, 관리자 승인·반려, 본인 대기 요청 취소.
- 정정 전 원본과 승인 이력 보존, 변경 후 오래된 정정 승인 차단.
- 실제 등록 직원·승인 일정 기반 팀 현황.
- 관리자 사무실 좌표·반경 설정, 사용 중 GPS 측정, 서버의 거리·오차·최신성 판정.
- 승인된 외근일의 위치 예외, 실패 시 정정 경로. 상시 위치 추적 없음.

**연차 1일=8시간·반차=4시간**으로 관리자 기초 잔액·승인 차감·취소 승인 복원을 지원합니다. 다일 연차는 실제 사용일수를 입력합니다. 관리자 ‘월별 집계’에서 전사 기록·CSV·마감·재개방을 처리합니다. 근무일·공휴일·반차 시간 구간과 급여 금액은 임의 추정하지 않습니다.

## 모노레포

```text
apps/employee/     React 19 + Vite 8 + Capacitor 8 직원 앱, iOS/Android 기본 프로젝트
apps/admin/        React 관리자 웹
apps/api/          Fastify API, SQLite 마이그레이션·인증·근태·승인
packages/ui/       Tailwind 4 토큰과 공통 컴포넌트
packages/domain/   실근무 계산, 한국 시간대, 순수 로직 테스트
packages/contracts/  Zod API 입력 계약과 공통 타입
packages/app/      공통 화면·라우팅·서버 어댑터·개발용 시연
```

## 근무 기준

오전 8시부터 자유 출근, 일일 실근무 480분. 11:30~13:00 점심 휴게와 실제 근무 구간의 중첩만 제외합니다. 08:00 출근은 17:30, 09:00 출근은 18:30 예상입니다. 목표 도달 시 자동 퇴근하지 않으며 조기·초과 퇴근도 실제 시각을 보존합니다. 8시 이전 기록은 삭제하지 않고 확인 필요로 표시합니다. 같은 날 근무만 지원하며 자정을 넘긴 실제 근무는 담당자 확인이 필요합니다.

## 검증

```bash
pnpm check              # 타입 + 도메인/API 테스트 + 웹 빌드/API 검사
pnpm format:check
pnpm exec playwright install chromium
pnpm test:e2e           # 명시적 가상 데이터 모드, 모바일/데스크톱
pnpm test:e2e:live      # 임시 DB의 실제 API·두 사용자·초대·기록·승인·차단
```

기존 Chromium은 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 지정할 수 있습니다. 실제 API 브라우저 테스트는 별도 포트와 임시 DB를 사용하고 종료 시 제거합니다. 테스트 전용 계정은 테스트 진입점에서만 생성되며 운영 서버는 생성하지 않습니다.

개발용 가상 화면은 로그인 화면의 ‘가상 데이터로 화면 시연 보기’ 또는 `/?demo=1`입니다. 실제 서버 데이터와 합치지 않습니다. 개발용 시연을 나가려면 해당 탭의 sessionStorage `punchin-demo-mode`를 삭제하거나 새 브라우저 세션을 사용하세요. 프로덕션 빌드에서는 가상 화면 진입이 비활성화됩니다.

- [Docker·HTTPS 배포와 복구](docs/deployment.md)
- [사내 파일럿 QA 실행표](docs/qa.md)
- [서버·보안·운영](docs/server.md)
- [GPS 설정과 실제 사무실 검증](docs/location.md)
- [구현 범위와 남은 작업](docs/implementation.md)
- [디자인 시스템](docs/design-system.md)
- [iPhone·Android 개발](docs/mobile.md)

## 운영·모바일 준비

`pnpm deploy:init`으로 비공개 배포 설정과 MFA 보관 키를 생성하고 회사 도메인을 설정합니다. 실제 서버 설치는 [배포 문서](docs/deployment.md)를 참고하세요. 모바일은 회사 HTTPS 주소로 `build:native`하고 회사 키로 서명합니다. 컴파일 CI의 `.invalid` 주소 빌드는 회사 사용용이 아닙니다.
