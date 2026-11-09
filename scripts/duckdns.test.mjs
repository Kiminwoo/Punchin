import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configuration, update } from './duckdns.mjs';

const env = {
  DUCKDNS_DOMAINS: 'employee-beta,admin-beta',
  DUCKDNS_TOKEN: 'fake-token-for-offline-tests-only',
};

test('missing credentials and unsafe or repeated hostnames are rejected before network access', () => {
  for (const values of [
    {},
    { ...env, DUCKDNS_TOKEN: '' },
    { ...env, DUCKDNS_DOMAINS: 'same,same' },
    { ...env, DUCKDNS_DOMAINS: 'valid,other.example.com' },
    { ...env, DUCKDNS_IPV4: '::1' },
  ])
    assert.throws(() => configuration(values));
});

test('updater submits both names over HTTPS with a timeout and no redirects', async () => {
  const config = configuration({ ...env, DUCKDNS_IPV4: '192.0.2.1' });
  await update(config, async (url, options) => {
    assert.equal(url.origin, 'https://www.duckdns.org');
    assert.equal(url.searchParams.get('domains'), env.DUCKDNS_DOMAINS);
    assert.equal(url.searchParams.get('token'), env.DUCKDNS_TOKEN);
    assert.equal(url.searchParams.get('ip'), '192.0.2.1');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response('OK\n');
  });
});

test('provider rejection and network errors redact request URL and account-wide token', async () => {
  for (const fetcher of [
    async () => new Response('KO'),
    async () => new Response('OK', { status: 503 }),
    async (url) => {
      throw new Error(url.href);
    },
  ]) {
    await assert.rejects(update(configuration(env), fetcher), (error) => {
      assert.match(error.message, /갱신 실패/);
      assert.ok(!error.message.includes(env.DUCKDNS_TOKEN));
      assert.ok(!error.message.includes('https://'));
      return true;
    });
  }
});

const initializer = resolve('scripts/init-oracle-beta.mjs');
function fixture(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'punchin-deploy-'));
  try {
    fn(cwd, (...names) =>
      spawnSync(process.execPath, [initializer, ...names], { cwd, encoding: 'utf8' }),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('beta initialization generates private files and refuses to overwrite an existing setup', () =>
  fixture((cwd, run) => {
    const first = run('employee-beta', 'admin-beta');
    assert.equal(first.status, 0, first.stderr);
    const path = join(cwd, 'deploy/.env');
    const contents = readFileSync(path, 'utf8');
    assert.match(contents, /EMPLOYEE_DOMAIN=employee-beta.duckdns.org/);
    const key = contents.match(/MFA_ENCRYPTION_KEY=(.+)/)[1];
    assert.equal(Buffer.from(key, 'base64').length, 32);
    assert.ok(!first.stdout.includes(key));
    for (const name of ['.env', '.env.duckdns'])
      assert.equal(statSync(join(cwd, 'deploy', name)).mode & 0o777, 0o600);
    assert.equal(run('employee-beta', 'admin-beta').status, 1);
    assert.equal(readFileSync(path, 'utf8'), contents);
  }));

test('existing MFA key and unrelated settings survive configuring a blank deployment', () =>
  fixture((cwd, run) => {
    mkdirSync(join(cwd, 'deploy'));
    const key = Buffer.alloc(32, 7).toString('base64');
    writeFileSync(
      join(cwd, 'deploy/.env'),
      `EMPLOYEE_DOMAIN=\nADMIN_DOMAIN=\nMFA_ENCRYPTION_KEY=${key}\nOTHER_SETTING=keep\n`,
    );
    assert.equal(run('employee-beta', 'admin-beta').status, 0);
    const contents = readFileSync(join(cwd, 'deploy/.env'), 'utf8');
    assert.ok(contents.includes(`MFA_ENCRYPTION_KEY=${key}`));
    assert.ok(contents.includes('OTHER_SETTING=keep'));
    assert.equal((contents.match(/^EMPLOYEE_DOMAIN=/gm) ?? []).length, 1);
    assert.equal((contents.match(/^ADMIN_DOMAIN=/gm) ?? []).length, 1);
    assert.ok(contents.includes('EMPLOYEE_DOMAIN=employee-beta.duckdns.org'));
  }));

test('conflicting existing domains are left intact', () =>
  fixture((cwd, run) => {
    mkdirSync(join(cwd, 'deploy'));
    const path = join(cwd, 'deploy/.env');
    const contents = 'EMPLOYEE_DOMAIN=already.example.com\n';
    writeFileSync(path, contents);
    assert.equal(run('employee-beta', 'admin-beta').status, 1);
    assert.equal(readFileSync(path, 'utf8'), contents);
    assert.equal(existsSync(join(cwd, 'deploy/.env.duckdns')), false);
  }));
