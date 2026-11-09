import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export function duckdnsName(value) {
  const name = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.duckdns\.org$/, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))
    throw new Error('DuckDNS에서 등록한 하위 주소 이름을 입력하세요.');
  return name;
}

export function configuration(env) {
  const domains = String(env.DUCKDNS_DOMAINS ?? '')
    .split(',')
    .map(duckdnsName);
  if (domains.length !== 2 || new Set(domains).size !== 2)
    throw new Error('직원·관리자용 서로 다른 DuckDNS 주소 두 개가 필요합니다.');
  const token = String(env.DUCKDNS_TOKEN ?? '').trim();
  if (!/^[A-Za-z0-9-]{20,128}$/.test(token))
    throw new Error('비공개 설정 파일에 DuckDNS 토큰을 입력하세요.');
  const ip = String(env.DUCKDNS_IPV4 ?? '').trim();
  if (ip && isIP(ip) !== 4) throw new Error('DuckDNS IPv4 설정을 확인하세요.');
  return { domains, token, ip };
}

export async function update(config, fetcher = fetch) {
  const url = new URL('https://www.duckdns.org/update');
  url.search = new URLSearchParams({
    domains: config.domains.join(','),
    token: config.token,
    ip: config.ip,
  }).toString();
  try {
    const response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || (await response.text()).trim() !== 'OK') throw new Error();
  } catch {
    // Errors can contain the full request URL, including the account-wide token.
    throw new Error('DuckDNS 갱신 실패: 네트워크·주소 소유권·비공개 토큰을 확인하세요.');
  }
}

async function main() {
  const config = configuration(process.env);
  const once = process.argv.includes('--once');
  do {
    try {
      await update(config);
      console.log('DuckDNS 주소 두 개의 IPv4 갱신을 완료했습니다.');
    } catch (error) {
      console.error(error.message);
      if (once) {
        process.exitCode = 1;
        return;
      }
    }
    if (!once) await setTimeout(5 * 60_000);
  } while (!once);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
