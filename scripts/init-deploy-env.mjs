import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const path = resolve(process.argv[2] ?? 'deploy/.env');
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
writeFileSync(
  path,
  `EMPLOYEE_DOMAIN=\nADMIN_DOMAIN=\nMFA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`,
  { flag: 'wx', mode: 0o600 },
);
console.log(
  '배포 설정 파일을 생성했습니다. 로컬 편집기로 두 도메인을 설정하세요. 보관 키는 출력하지 않습니다. 기존 파일은 덮어쓰지 않습니다.',
);
