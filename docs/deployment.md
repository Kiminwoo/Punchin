# 회사 서버 배포 준비

공통 배포 구성은 Docker Compose + Caddy HTTPS + 단일 SQLite 영속 볼륨입니다. 사용자는 **혼자 사용하는 Oracle Always Free + DuckDNS 베타**로 진행하기로 했고 계정 가입부터 필요합니다. 해당 경로는 [Oracle 베타 안내](oracle-beta.md)를 따릅니다. 실제 회사 서버나 도메인에 배포하지 않았습니다.

## 준비할 것

- Docker Engine/Compose가 있는 회사 소유 Linux VM 한 대.
- 직원·관리자용 도메인 두 개와 서버로 향하는 DNS. 예: attendance.company-domain / attendance-admin.company-domain.
- 외부에 80/443 허용, 관리 SSH 접근 제한. API의 3001 포트는 공개하지 않습니다.
- 백업의 외부 보관 위치, 운영 담당자와 장애 알림 수신처.
- 앱 배포용 회사 Apple/Google 개발자 계정과 실제 서버 HTTPS 주소.

## 설정 파일과 보관 키

```bash
pnpm deploy:init
```

`deploy/.env`를 새로 생성하고 32바이트 MFA 보관 키를 기록합니다. 키는 출력하지 않고 파일 권한을 600으로 설정합니다. 기존 파일이 있으면 거부하므로 운영 키를 실수로 덮어쓰지 않습니다. 로컬 편집기로 EMPLOYEE_DOMAIN, ADMIN_DOMAIN을 실제 도메인으로 채우세요. MFA_ENCRYPTION_KEY는 DB 백업과 별도로 회사의 비밀번호 관리 도구 등에 보관해야 합니다. 키를 바꾸거나 잃으면 인증앱 비밀키를 읽을 수 없으므로 임의 회전하지 않습니다.

`deploy/.env`, 실제 비밀번호, DB, 앱 서명 키는 Git 대상에서 제외됩니다. 클라우드·GitHub Secrets 등에 값을 등록할 때도 채팅으로 전달하지 마세요.

## 이미지와 시작

```bash
docker compose --env-file deploy/.env config --quiet
docker compose --env-file deploy/.env build
docker compose --env-file deploy/.env up -d
docker compose --env-file deploy/.env ps
```

Caddy가 DNS와 80/443 접근이 가능한 경우 인증서를 발급합니다. 별도 정적 웹 호스팅으로 관리자/직원 화면만 올려서는 API·쿠키·DB가 연결되지 않습니다. Compose는 API를 비공개 네트워크에 두고 두 HTTPS 웹 호스트의 `/api`를 전달합니다. API는 비루트 사용자, 읽기 전용 루트 파일시스템으로 실행하고 `/data`, `/backups`, `/tmp`만 쓰도록 구성했습니다.

초기 관리자 자격정보는 서버의 비공개 환경 또는 비밀 파일에 설정한 뒤, 같은 DB 볼륨을 사용하는 일회성 bootstrap 명령으로 생성합니다. 예를 들어 비공개 `deploy/admin.env`에 ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD를 기록하고 다음을 실행할 수 있습니다.

```bash
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.bootstrap.yaml run --rm api
```

`deploy/admin.env`는 600 권한의 비공개 파일로 관리하고 비밀번호를 명령어 인자에 직접 적지 마세요. 생성 후 파일은 회사의 비밀 관리 정책에 따라 제거/보관합니다. 평소 서버 실행에는 bootstrap override 파일을 사용하지 않습니다.

관리자 웹에 로그인하고 ‘설정 → 관리자 2단계 인증’을 먼저 등록합니다. Compose 운영 구성은 관리자 MFA 등록을 요구하므로, 등록 전 직원 초대·승인·마감 등 관리자 작업은 차단됩니다. 초기 관리자 한 명만 있으므로 본인 휴가/정정 요청을 처리할 대체 관리자를 추가해야 합니다.

## 백업과 복구 훈련

```bash
docker compose --env-file deploy/.env exec -T api ./node_modules/.bin/tsx src/backup.ts
```

실행 중 WAL DB의 SQLite online backup을 만들고 무결성을 검사합니다. 파일은 `/backups` 볼륨에 600 권한으로 저장합니다. 기존 목적지는 덮어쓰지 않습니다. 같은 서버의 백업만으로 서버 유실에 대비할 수 없으므로 외부 암호화 보관을 추가해야 합니다.

`deploy/punchin-backup.service`, `.timer`는 `/opt/punchin` 설치를 가정한 예제입니다. 실제 서버에서 경로를 조정하고 systemd에 설치하면 매일 한국 시간 03:00 전후 백업을 수행합니다. 이 작업은 현재 개발 환경이나 사용자 서버에 설치·예약하지 않았습니다. 오래된 백업/직원 자료 자동 삭제도 보관 정책 확정 전에는 실행하지 않습니다.

복구 훈련은 별도의 빈 볼륨/격리 환경에서 수행하세요. 정상 종료 후 최신 검증 백업을 새 DB 경로에 복원하고, 같은 MFA 보관 키로 계정·근태·승인·마감본·휴가 잔액을 확인합니다. 운영 원본 파일이나 WAL을 바로 삭제/덮어쓰지 마세요. 새 버전 배포 전에도 백업을 생성하고 DB 마이그레이션이 있으면 코드 롤백과 DB 복구를 함께 검토합니다.

## 출시 확인

직원/관리자 HTTPS 로그인, 쿠키 Secure, MFA, 권한 차단, 정밀 위치 거부, 실제 사무실 위치, 출퇴근 재전송, 휴가 취소 복원, 월별 마감/재개방, 백업 복구를 실제 기기로 확인합니다. 네이티브 CI에서 만들어지는 `.invalid` 서버 주소의 테스트 빌드는 회사 배포용 앱이 아닙니다. 실제 앱은 회사 HTTPS 주소로 다시 빌드하고 회사 키로 서명해야 합니다.
