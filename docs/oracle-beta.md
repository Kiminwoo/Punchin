# 혼자 사용하는 Oracle Cloud + DuckDNS 베타

이 경로는 사용자가 선택한 1인 베타 구성입니다. Oracle Always Free VM 한 대에서 직원 웹·관리자 웹·API·SQLite를 실행하고, DuckDNS 주소 두 개를 연결합니다. 상용 전환이나 유료 자원 생성은 포함하지 않습니다. 현재 계정은 아직 없고 실제 서버·주소·인증서·운영 계정도 생성하지 않았습니다.

## 1. Oracle 가입 — 먼저 직접 진행할 단계

1. [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)에서 무료 계정을 만듭니다.
2. 이메일·본인 확인과 결제수단 검증은 본인이 진행합니다. 카드·비밀번호·인증번호를 채팅에 전달하지 않습니다. 가입 승인과 자원 제공은 Oracle이 결정합니다.
3. 홈 리전은 한국 리전을 우선 검토하고 ARM 무료 자원 제공 여부를 확인합니다. 홈 리전은 쉽게 바꾸는 설정이 아니므로 선택 전 확인합니다.
4. 무료 체험 크레딧과 Always Free를 구분합니다. 무료 체험 기간의 유료 자원은 체험 종료 후에도 무료인 자원이 아닙니다. Pay As You Go 업그레이드는 이 베타 절차에 필요하지 않습니다.

가입이 끝나면 다음 단계로 진행합니다. 현재는 여기까지 사용자 작업이 필요하며, 이 문서의 나머지는 이후 실행할 절차입니다.

## 2. 무료 서버 생성

콘솔의 Compute → Instances → Create instance에서 다음 구성을 확인합니다. 콘솔 이름과 무료 정책은 바뀔 수 있으므로 생성 직전 가격·무료 표시를 다시 확인합니다.

| 항목          | 베타 권장값                                            |
| ------------- | ------------------------------------------------------ |
| 인스턴스 이름 | `punchin-beta`                                         |
| 이미지        | ARM64용 Ubuntu 24.04 LTS, 유료 Marketplace 이미지 제외 |
| Shape         | `VM.Standard.A1.Flex`, **Always Free 대상** 확인       |
| CPU·메모리    | **1 OCPU / 4GB**부터 시작                              |
| 부트 디스크   | 기본 약 50GB, 계정 전체 무료 디스크 한도 내            |
| 네트워크      | 인터넷 게이트웨이가 연결된 공개 서브넷, 공개 IPv4 할당 |
| SSH 키        | 공개키만 등록하고 개인키는 본인 PC에 보관              |
| 추가 서비스   | 별도 유료 DB·로드밸런서·추가 디스크 생성 안 함         |

무료 자원 부족 오류가 나면 생성이 완료된 것이 아닙니다. 유료 Shape로 대신 만들지 말고 중단 후 다시 계획합니다. ARM 무료 한도와 회수 조건은 [Oracle 공식 문서](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)를 따릅니다. 과거 안내의 자원 수치를 그대로 적용하지 않습니다.

SSH 개인키 파일은 채팅·Git에 올리지 않습니다. 개인키 경로는 자신의 PC에서만 사용합니다. Ubuntu 기본 접속 계정은 `ubuntu`입니다. Mac/Linux에서는 필요하면 개인키에 `chmod 600`을 적용합니다.

```bash
ssh -i ~/.ssh/punchin-beta ubuntu@서버의_공개_IP
```

키 파일 이름과 경로는 실제 생성한 값으로 바꿉니다. 위 IP는 예시 자리표시자입니다.

## 3. 네트워크 접근 허용

VM에 적용되는 OCI Security List/NSG에서 다음 수신 규칙을 설정합니다.

| 프로토콜·포트 | 허용 출발지               | 용도                               |
| ------------- | ------------------------- | ---------------------------------- |
| TCP 22        | 본인 접속 공인 IP의 `/32` | SSH 관리                           |
| TCP 80        | `0.0.0.0/0`               | HTTPS 인증서 발급·HTTPS 리다이렉트 |
| TCP 443       | `0.0.0.0/0`               | 휴대폰·관리자 HTTPS 접속           |

API 3001·개발 서버 5173/5174·DB 포트는 공개하지 않습니다. UDP 443은 HTTP/3을 쓸 경우에만 추가하며 베타에는 필수가 아닙니다. 이 절차는 IPv4 기준입니다. DuckDNS에 예전 IPv6 AAAA 레코드가 있다면 제거하거나 실제 IPv6 경로도 별도로 구성해야 합니다.

Oracle 이미지의 호스트 방화벽도 확인합니다. Docker의 공개 포트는 UFW 규칙을 우회할 수 있으므로 OCI 수신 규칙과 Compose 포트 구성을 함께 확인합니다. 방화벽 전체를 끄거나 `iptables`를 초기화하지 않습니다. 외부 접속 오류 때는 OCI 규칙·공개 IP·호스트 규칙·컨테이너 순서로 점검합니다.

## 4. DuckDNS 가입과 주소 등록

1. [DuckDNS](https://www.duckdns.org/)에 본인 계정으로 로그인합니다.
2. 직원용·관리자용으로 **서로 다른 이름 두 개**를 등록합니다. 예: `my-punchin-beta`, `my-punchin-admin-beta`. 예시는 예약·등록된 실제 주소가 아닙니다.
3. 두 주소의 IPv4에 Oracle VM의 **공개 IPv4**를 입력합니다. PC의 IP나 VM의 사설 IP가 아닙니다.
4. 계정 토큰은 비공개로 보관합니다. 계정 전체 주소에 영향을 줄 수 있으므로 채팅·스크린샷·Git에 포함하지 않습니다.

## 5. Ubuntu 서버에 Docker와 소스 준비

다음은 새 Ubuntu 24.04 ARM64 VM에 SSH로 접속한 뒤 실행할 예시입니다. 기존 서버의 패키지나 방화벽을 임의 초기화하지 않습니다. [Docker 공식 Ubuntu 안내](https://docs.docker.com/engine/install/ubuntu/)를 기준으로 합니다.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git dnsutils nano
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

SSH를 종료하고 다시 접속해 Docker 그룹 권한을 적용합니다. Docker 그룹은 강한 서버 권한이므로 다른 사용자를 임의 추가하지 않습니다.

```bash
docker version
docker compose version
sudo install -d -o "$USER" -g "$(id -gn)" -m 750 /opt/punchin
git clone https://github.com/Kiminwoo/Punchin.git /opt/punchin
cd /opt/punchin
```

호스트에 Node·pnpm을 별도 설치하지 않고 Docker로 빌드합니다. 저장소가 비공개로 바뀌면 별도의 저장소 인증이 필요합니다.

## 6. 실제 주소와 비밀값 설정

DuckDNS에서 본인이 등록한 실제 이름으로 아래 두 이름을 바꿉니다. 이 명령은 주소를 새로 등록하지 않고 로컬 배포 설정만 만듭니다.

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24-alpine node scripts/init-oracle-beta.mjs my-punchin-beta my-punchin-admin-beta
nano deploy/.env.duckdns
```

`DUCKDNS_TOKEN=` 뒤에 서버 편집기에서 토큰을 직접 입력합니다. `DUCKDNS_IPV4`는 비워 두면 DuckDNS가 이 VM의 요청 IPv4를 사용합니다. 프록시 등으로 다른 IP가 감지되는 환경이면 실제 VM 공개 IPv4를 명시합니다.

초기화 도구는 `deploy/.env`의 기존 MFA 키를 유지하고, 이미 다른 도메인이 설정돼 있거나 DuckDNS 설정이 있으면 덮어쓰지 않습니다. 두 비밀 파일 권한은 600입니다. `.env`의 MFA 키는 비공개 비밀번호 관리 도구 등에 별도 보관합니다. `docker compose config` 전체 출력에는 비밀값이 포함될 수 있으므로 아래처럼 `--quiet`를 사용합니다.

```bash
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.duckdns.yaml config --quiet
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.duckdns.yaml run --rm --no-deps duckdns --once
```

성공 메시지가 표시된 뒤 `dig +short 실제직원주소.duckdns.org A`, 관리자 주소도 동일하게 조회해 두 주소가 VM 공개 IPv4를 가리키는지 확인합니다. DNS 전파에 시간이 필요할 수 있습니다. 이 갱신 요청은 지정한 실제 DuckDNS 레코드를 변경합니다. 갱신 실패를 숨기거나 성공으로 처리하지 않습니다.

## 7. 실행과 본인 계정 생성

```bash
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.duckdns.yaml build
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.duckdns.yaml up -d
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.duckdns.yaml ps
```

빌드는 ARM VM에서 직접 수행하므로 호스트 아키텍처에 맞는 의존성을 설치합니다. 현재 개발 환경의 amd64 이미지나 네이티브 모듈을 복사하지 않습니다. ARM 실제 빌드·운영은 VM 생성 후 확인할 항목입니다. API가 healthy이고 웹·DuckDNS가 실행 중이어야 합니다. DuckDNS는 시작 시와 5분마다 갱신하며 외부 API 오류가 나면 비밀값을 출력하지 않고 재시도합니다. 컨테이너 실행 상태만으로 DNS·HTTPS 성공을 판단하지 않습니다.

다음 명령은 비공개 관리자 파일을 **새로** 만들고 기존 파일이 있으면 덮어쓰지 않습니다.

```bash
(umask 077; set -C; cat >deploy/admin.env <<'EOF'
ADMIN_EMAIL=
ADMIN_NAME=
ADMIN_PASSWORD=
EOF
)
nano deploy/admin.env
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.bootstrap.yaml run --rm --no-deps api
```

이메일·이름·12자 이상의 비밀번호를 서버 편집기에서 직접 입력합니다. 환경 파일에서 특별한 문자가 있는 값은 작은따옴표로 감싸는 등 Docker Compose env 파일 규칙을 따릅니다. 파일 내용과 비밀번호를 명령어 인자·채팅으로 출력하지 않습니다. 초기 관리자 생성은 한 번만 수행하고, 파일은 회사의 비밀 관리 방식으로 보관/제거합니다.

관리자 HTTPS 주소로 로그인해 ‘설정 → 관리자 2단계 인증’을 먼저 등록하고 복구 코드를 별도 보관합니다. 본인 직원 테스트 계정을 초대해 직원 HTTPS 주소에서 활성화합니다. 본인 신청을 본인이 승인하지 못하는 권한 규칙은 베타에서도 유지합니다. 혼자 승인 흐름까지 검증하려면 명확히 구분한 별도 베타 계정을 사용하며 실제 직원에게 가입을 요청하지 않습니다.

## 8. 휴대폰 베타와 백업

우선 iPhone Safari·갤럭시 Chrome에서 실제 직원 **HTTPS 주소**에 접속해 테스트할 수 있습니다. 앱스토어 설치 앱·PWA 설치가 완료됐다는 뜻은 아닙니다. 네이티브 설치 앱은 실제 HTTPS 주소로 다시 빌드하고 별도 서명·실기기 검증이 필요합니다. GPS는 현장 검증 전까지 활성화하지 않습니다.

```bash
docker compose --env-file deploy/.env exec -T api ./node_modules/.bin/tsx src/backup.ts
```

동일 VM의 `/backups` 볼륨만으로는 서버 회수·유실에 대비할 수 없습니다. 예를 들어 SSH로 `docker compose --env-file deploy/.env cp api:/backups ./private-backups`를 실행해 비공개 서버 폴더로 복사한 뒤, 본인 PC에서 해당 폴더를 `scp -r`로 내려받습니다. 그 전에 서버 폴더를 `install -d -m 700 private-backups`로 만듭니다. PC의 백업 경로도 비공개로 관리하고 MFA 키는 DB와 별도 보관합니다. 새 테스트 데이터가 생기면 백업을 갱신합니다. 자동 외부 업로드·백업 삭제·타이머 설치는 실행하지 않았습니다. 자동화가 필요하면 본인 소유 외부 저장 위치를 정한 뒤 추가합니다.

중지할 때 `docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.duckdns.yaml stop`을 사용하면 데이터 볼륨이 유지됩니다. `down -v`나 볼륨 삭제는 기록을 지울 수 있으므로 사용하지 않습니다.

## 단계별 완료 기준

- 계정: 본인 가입 완료, Pay As You Go로 업그레이드하지 않음.
- 서버: 무료 대상 VM 실행, SSH 접속, Oracle 네트워크 규칙 확인.
- DNS: 본인이 소유한 두 이름의 A 레코드가 VM 공개 IPv4와 일치.
- 서비스: API healthy, 외부에서 두 HTTPS 주소 접속·인증서 확인.
- 베타: MFA·초대·휴대폰 출퇴근·새로고침·재로그인·휴가 원장·백업 복구를 [QA 실행표](qa.md)로 확인.
- 운영 경계: 회사 공식 기록으로 사용하지 않고, 아직 실제 서버 생성·배포·현장 QA가 끝나지 않은 항목은 완료로 표시하지 않음.
