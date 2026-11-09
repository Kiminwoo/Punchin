import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { duckdnsName } from './duckdns.mjs';

try {
  if (process.argv.length !== 4)
    throw new Error('사용법: node scripts/init-oracle-beta.mjs 직원주소이름 관리자주소이름');
  const names = process.argv.slice(2).map(duckdnsName);
  if (names[0] === names[1]) throw new Error('서로 다른 주소 두 개를 입력하세요.');
  mkdirSync('deploy', { recursive: true });
  if (existsSync('deploy/.env.duckdns')) throw new Error('기존 DuckDNS 설정은 덮어쓰지 않습니다.');
  const source = existsSync('deploy/.env') ? readFileSync('deploy/.env', 'utf8') : '';
  const current = parseEnv(source);
  const domains = names.map((name) => `${name}.duckdns.org`);
  for (const [key, expected] of [
    ['EMPLOYEE_DOMAIN', domains[0]],
    ['ADMIN_DOMAIN', domains[1]],
  ])
    if (current[key] && current[key] !== expected)
      throw new Error('기존 배포 도메인이 다릅니다. 설정을 직접 확인하세요.');
  const key = current.MFA_ENCRYPTION_KEY ?? randomBytes(32).toString('base64');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32)
    throw new Error('기존 MFA 보관 키를 확인하세요. 임의로 교체하지 않습니다.');
  let contents = source;
  for (const [name, value] of [
    ['EMPLOYEE_DOMAIN', domains[0]],
    ['ADMIN_DOMAIN', domains[1]],
    ['MFA_ENCRYPTION_KEY', key],
  ]) {
    const line = new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`, 'gm');
    contents = line.test(contents)
      ? contents.replace(line, `${name}=${value}`)
      : `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${name}=${value}\n`;
  }
  writeFileSync('deploy/.env', contents, { mode: 0o600 });
  chmodSync('deploy/.env', 0o600);
  writeFileSync(
    'deploy/.env.duckdns',
    `DUCKDNS_DOMAINS=${names.join(',')}\nDUCKDNS_TOKEN=\n# 비워 두면 DuckDNS가 이 서버의 요청 IPv4를 사용합니다.\nDUCKDNS_IPV4=\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    '베타 설정을 생성했습니다. deploy/.env.duckdns에 토큰을 직접 입력하세요. 기존 MFA 키는 유지했고 비밀값은 출력하지 않습니다.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
