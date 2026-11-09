import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database';
import { createServer } from './app';
import type { UserRow } from './service';
const origin = 'http://localhost:5173';
const password = 'Only-for-automated-tests-42!';
type Identity = { cookie: string; csrf: string; id: string };
describe('server authentication and attendance integrity', () => {
  let runtime: Awaited<ReturnType<typeof createServer>>;
  let db: ReturnType<typeof openDatabase>;
  let now: Date;
  let admin: Identity;
  let employee: Identity;
  const call = (
    identity: Identity | null,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
    extra: Record<string, string> = {},
  ) =>
    runtime.app.inject({
      method,
      url,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
      headers: {
        origin,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(identity ? { cookie: identity.cookie, 'x-csrf-token': identity.csrf } : {}),
        ...extra,
      },
    });
  async function login(email: string): Promise<Identity> {
    const res = await call(null, 'POST', '/api/auth/login', { email, password });
    expect(res.statusCode).toBe(200);
    return {
      id: res.json().user.id,
      csrf: res.json().csrfToken,
      cookie: `punchin_session=${res.cookies.find((c) => c.name === 'punchin_session')!.value}`,
    };
  }
  beforeEach(async () => {
    db = openDatabase(':memory:');
    now = new Date('2026-11-09T01:00:00Z');
    runtime = await createServer({ db, now: () => now });
    await runtime.store.createAdmin('admin@example.test', '관리자', password);
    admin = await login('admin@example.test');
    const invite = await call(admin, 'POST', '/api/admin/invitations', {
      email: 'staff@example.test',
      name: '직원',
      team: '개발',
    });
    const activation = await call(null, 'POST', '/api/auth/activate', {
      token: invite.json().token,
      password,
    });
    expect(activation.statusCode).toBe(200);
    employee = await login('staff@example.test');
  });
  afterEach(async () => {
    await runtime.app.close();
    db.close();
  });
  it('requires login, exact origin and CSRF, and prevents employee administrator access', async () => {
    expect((await call(null, 'GET', '/api/workspace')).statusCode).toBe(401);
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in' },
          { origin: 'https://evil.example', 'idempotency-key': randomUUID() },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in' },
          { 'x-csrf-token': 'wrong', 'idempotency-key': randomUUID() },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(employee, 'POST', '/api/admin/invitations', {
          email: 'x@example.test',
          name: 'x',
          team: 'x',
        })
      ).statusCode,
    ).toBe(403);
    expect((await call(employee, 'GET', '/api/admin/audit')).statusCode).toBe(403);
    expect((await call(employee, 'GET', '/api/workspace?userId=' + admin.id)).json().user.id).toBe(
      employee.id,
    );
  });
  it('uses one-time expiring invitations and never exposes password hashes', async () => {
    const invite = (
      await call(admin, 'POST', '/api/admin/invitations', {
        email: 'new@example.test',
        name: '신규',
        team: '운영',
      })
    ).json();
    expect(
      (await call(null, 'POST', '/api/auth/activate', { token: invite.token, password }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(null, 'POST', '/api/auth/activate', { token: invite.token, password }))
        .statusCode,
    ).toBe(400);
    const another = (
      await call(admin, 'POST', '/api/admin/invitations', {
        email: 'expired@example.test',
        name: '만료',
        team: '운영',
      })
    ).json();
    now = new Date(now.getTime() + 73 * 3600000);
    expect(
      (await call(null, 'POST', '/api/auth/activate', { token: another.token, password }))
        .statusCode,
    ).toBe(400);
    expect(JSON.stringify(await login('admin@example.test'))).not.toContain('scrypt');
  });
  it('creates an HttpOnly session and does not accept arbitrary device timestamps', async () => {
    const result = await call(null, 'POST', '/api/auth/login', {
      email: 'staff@example.test',
      password,
    });
    expect(result.headers['set-cookie']).toContain('HttpOnly');
    expect(result.headers['set-cookie']).toContain('SameSite=Lax');
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in', time: '08:00' },
          { 'idempotency-key': randomUUID() },
        )
      ).statusCode,
    ).toBe(400);
  });
  it('records server time and deduplicates concurrent replays', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in' },
          { 'idempotency-key': key },
        ),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body)).size).toBe(1);
    expect(results[0]!.json().recordedAt).toBe(now.toISOString());
    expect(runtime.store.one<{ n: number }>('SELECT count(*) as n FROM events')!.n).toBe(1);
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in' },
          { 'idempotency-key': randomUUID() },
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'out' },
          { 'idempotency-key': key },
        )
      ).statusCode,
    ).toBe(409);
  });
  it('preserves early checkout and separates original record from an approved correction', async () => {
    await call(
      employee,
      'POST',
      '/api/attendance/clock',
      { action: 'in' },
      { 'idempotency-key': randomUUID() },
    );
    now = new Date('2026-11-09T02:00:00Z');
    await call(
      employee,
      'POST',
      '/api/attendance/clock',
      { action: 'out' },
      { 'idempotency-key': randomUUID() },
    );
    const request = await call(employee, 'POST', '/api/requests', {
      type: '기록 정정',
      date: '2026-11-09',
      endDate: '2026-11-09',
      reason: '실제 출근시각 확인',
      time: '08:30',
    });
    expect(
      (await call(admin, 'PATCH', `/api/requests/${request.json().id}`, { status: 'approved' }))
        .statusCode,
    ).toBe(200);
    const snapshot = (await call(employee, 'GET', '/api/workspace')).json();
    expect(snapshot.day).toMatchObject({
      start: '08:30',
      end: '11:00',
      originalStart: '10:00',
      corrected: true,
    });
    expect(
      runtime.store.one<{ start_at: string }>('SELECT start_at FROM attendance')!.start_at,
    ).toBe('2026-11-09T01:00:00.000Z');
    expect(
      (await call(admin, 'PATCH', `/api/requests/${request.json().id}`, { status: 'approved' }))
        .statusCode,
    ).toBe(409);
  });
  it('rejects stale correction approvals after another attendance mutation', async () => {
    await call(
      employee,
      'POST',
      '/api/attendance/clock',
      { action: 'in' },
      { 'idempotency-key': randomUUID() },
    );
    const req = (
      await call(employee, 'POST', '/api/requests', {
        type: '기록 정정',
        date: '2026-11-09',
        endDate: '2026-11-09',
        reason: '출근 정정',
        time: '09:00',
      })
    ).json();
    now = new Date('2026-11-09T03:00:00Z');
    await call(
      employee,
      'POST',
      '/api/attendance/clock',
      { action: 'out' },
      { 'idempotency-key': randomUUID() },
    );
    expect(
      (await call(admin, 'PATCH', `/api/requests/${req.id}`, { status: 'approved' })).statusCode,
    ).toBe(409);
    expect((await call(employee, 'GET', '/api/workspace')).json().requests[0].status).toBe(
      'pending',
    );
  });
  it('prevents self approval, other-user cancellation, invalid ranges and future corrections', async () => {
    const own = (
      await call(admin, 'POST', '/api/requests', {
        type: '연차',
        date: '2026-11-10',
        endDate: '2026-11-10',
        reason: '',
      })
    ).json();
    expect(
      (await call(admin, 'PATCH', `/api/requests/${own.id}`, { status: 'approved' })).statusCode,
    ).toBe(403);
    expect(
      (await call(employee, 'PATCH', `/api/requests/${own.id}`, { status: 'cancelled' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(admin, 'PATCH', `/api/requests/${own.id}`, { status: 'rejected' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(employee, 'POST', '/api/requests', {
          type: '연차',
          date: '2026-11-12',
          endDate: '2026-11-10',
          reason: '',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(employee, 'POST', '/api/requests', {
          type: '기록 정정',
          date: '2026-11-10',
          endDate: '2026-11-10',
          reason: '미래',
          time: '08:00',
        })
      ).statusCode,
    ).toBe(400);
  });
  it('restricts requests to their owner and blocks overlapping leave', async () => {
    const payload = { type: '연차', date: '2026-11-13', endDate: '2026-11-13', reason: '' };
    const req = (await call(employee, 'POST', '/api/requests', payload)).json();
    expect((await call(employee, 'POST', '/api/requests', payload)).statusCode).toBe(409);
    expect(
      (await call(employee, 'PATCH', `/api/requests/${req.id}`, { status: 'cancelled' }))
        .statusCode,
    ).toBe(200);
    expect((await call(employee, 'POST', '/api/requests', payload)).statusCode).toBe(200);
    const snapshot = (await call(employee, 'GET', '/api/workspace')).json();
    expect(snapshot.requests.every((r: { userId: string }) => r.userId === employee.id)).toBe(true);
    expect(snapshot.people.find((p: { id: string }) => p.id === admin.id).email).toBeUndefined();
  });
  it('revokes all existing sessions on deactivation and refuses disabled login', async () => {
    expect(
      (await call(admin, 'POST', `/api/admin/employees/${employee.id}/deactivate`)).statusCode,
    ).toBe(200);
    expect((await call(employee, 'GET', '/api/workspace')).statusCode).toBe(401);
    expect(
      (await call(null, 'POST', '/api/auth/login', { email: 'staff@example.test', password }))
        .statusCode,
    ).toBe(401);
    expect(
      (await call(admin, 'POST', `/api/admin/employees/${admin.id}/deactivate`)).statusCode,
    ).toBe(409);
  });
  it('expires sessions and invalidates a logged-out cookie', async () => {
    await call(employee, 'POST', '/api/auth/logout');
    expect((await call(employee, 'GET', '/api/workspace')).statusCode).toBe(401);
    now = new Date(now.getTime() + 8 * 3600000 + 1);
    expect((await call(admin, 'GET', '/api/workspace')).statusCode).toBe(401);
  });
  it('keeps raw events immutable and flags early arrivals without erasing them', async () => {
    now = new Date('2026-11-08T22:45:00Z');
    await call(
      employee,
      'POST',
      '/api/attendance/clock',
      { action: 'in' },
      { 'idempotency-key': randomUUID() },
    );
    expect((await call(employee, 'GET', '/api/workspace')).json().day).toMatchObject({
      start: '07:45',
      needsReview: true,
    });
    expect(() => db.exec("UPDATE events SET action='changed'")).toThrow('immutable');
    expect(() => db.exec('DELETE FROM audit')).toThrow('immutable');
  });
  it('applies approved checkout corrections without inventing a raw checkout and releases next-day attendance', async () => {
    await call(
      employee,
      'POST',
      '/api/attendance/clock',
      { action: 'in' },
      { 'idempotency-key': randomUUID() },
    );
    now = new Date('2026-11-10T01:00:00Z');
    employee = await login('staff@example.test');
    admin = await login('admin@example.test');
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in' },
          { 'idempotency-key': randomUUID() },
        )
      ).statusCode,
    ).toBe(409);
    const retry = (
      await call(employee, 'POST', '/api/requests', {
        type: '기록 정정',
        date: '2026-11-09',
        endDate: '2026-11-09',
        time: '18:30',
        field: 'end',
        reason: '퇴근 기록 누락',
      })
    ).json();
    expect(
      (await call(admin, 'PATCH', `/api/requests/${retry.id}`, { status: 'approved' })).statusCode,
    ).toBe(200);
    expect((await call(employee, 'GET', '/api/workspace')).json().history[0]).toMatchObject({
      end: '18:30',
      originalEnd: null,
      endCorrected: true,
    });
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in' },
          { 'idempotency-key': randomUUID() },
        )
      ).statusCode,
    ).toBe(200);
  });
  it('requires confirmed office coordinates, verifies fresh location, and stores no personal coordinates', async () => {
    const office = {
      name: '테스트 사무실',
      address: '자동 테스트 전용 주소',
      latitude: 37.5,
      longitude: 126.9,
      radius: 150,
      enabled: true,
      confirmed: false,
    };
    expect((await call(admin, 'PATCH', '/api/admin/office', office)).statusCode).toBe(400);
    office.confirmed = true;
    expect((await call(admin, 'PATCH', '/api/admin/office', office)).statusCode).toBe(200);
    expect((await call(employee, 'PATCH', '/api/admin/office', office)).statusCode).toBe(403);
    const clock = (location?: unknown, key = randomUUID()) =>
      call(
        employee,
        'POST',
        '/api/attendance/clock',
        { action: 'in', ...(location ? { location } : {}) },
        { 'idempotency-key': key },
      );
    expect((await clock()).statusCode).toBe(400);
    expect(
      (
        await clock({
          latitude: 37.5,
          longitude: 126.9,
          accuracy: 10,
          capturedAt: '2026-11-09T00:55:00Z',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await clock({ latitude: 38, longitude: 127, accuracy: 10, capturedAt: now.toISOString() }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await clock({
          latitude: 37.5012,
          longitude: 126.9,
          accuracy: 50,
          capturedAt: now.toISOString(),
        })
      ).statusCode,
    ).toBe(400);
    const key = randomUUID();
    expect(
      (
        await clock(
          { latitude: 37.5, longitude: 126.9, accuracy: 10, capturedAt: now.toISOString() },
          key,
        )
      ).statusCode,
    ).toBe(200);
    expect((await clock(undefined, key)).statusCode).toBe(200);
    const row = runtime.store.one<{ verification: string; evidence: string }>(
      'SELECT verification,evidence FROM events',
    )!;
    expect(row.verification).toBe('gps_checked');
    expect(
      runtime.store.one<{ verification: string }>('SELECT verification FROM attendance')!
        .verification,
    ).toBe('gps_checked');
    expect(row.evidence).not.toContain('latitude');
    expect(row.evidence).not.toContain('longitude');
  });
  it('allows approved fieldwork as a recorded location exception', async () => {
    runtime.store.updateOffice(
      runtime.store.one<UserRow>('SELECT * FROM users WHERE id=?', admin.id)!,
      {
        name: '현장',
        address: '테스트',
        latitude: 37.5,
        longitude: 126.9,
        radius: 150,
        enabled: true,
        confirmed: true,
      },
    );
    const request = (
      await call(employee, 'POST', '/api/requests', {
        type: '외근',
        date: '2026-11-09',
        endDate: '2026-11-09',
        reason: '거래처 방문',
      })
    ).json();
    await call(admin, 'PATCH', `/api/requests/${request.id}`, { status: 'approved' });
    expect(
      (
        await call(
          employee,
          'POST',
          '/api/attendance/clock',
          { action: 'in' },
          { 'idempotency-key': randomUUID() },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      runtime.store.one<{ verification: string }>('SELECT verification FROM events')!.verification,
    ).toBe('approved_fieldwork');
  });
  it('reissues invitation codes while invalidating earlier codes and enforces the twenty-person limit', async () => {
    const invite = (
      await call(admin, 'POST', '/api/admin/invitations', {
        email: 'reissue@example.test',
        name: '재초대',
        team: '개발',
      })
    ).json();
    const next = (
      await call(admin, 'POST', `/api/admin/employees/${invite.userId}/invitation`)
    ).json();
    expect(
      (await call(null, 'POST', '/api/auth/activate', { token: invite.token, password }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(null, 'POST', '/api/auth/activate', { token: next.token, password })).statusCode,
    ).toBe(200);
    const actor = runtime.store.one<UserRow>('SELECT * FROM users WHERE id=?', admin.id)!;
    for (let i = 0; i < 17; i++)
      runtime.store.invite(actor, {
        email: `limit${i}@example.test`,
        name: `직원${i}`,
        team: '개발',
      });
    expect(
      (
        await call(admin, 'POST', '/api/admin/invitations', {
          email: 'overflow@example.test',
          name: '초과',
          team: '개발',
        })
      ).statusCode,
    ).toBe(409);
  });
  it('keeps native bearer sessions separate from browser cookies and revokes them on logout', async () => {
    const login = await runtime.app.inject({
      method: 'POST',
      url: '/api/mobile/auth/login',
      headers: { 'x-punchin-client': 'native' },
      payload: { email: 'staff@example.test', password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toBeUndefined();
    const sessionToken = login.json().sessionToken;
    expect(sessionToken).toHaveLength(43);
    const headers = { authorization: `Bearer ${sessionToken}` };
    expect((await runtime.app.inject({ url: '/api/workspace', headers })).statusCode).toBe(200);
    expect(
      (
        await runtime.app.inject({
          url: '/api/workspace',
          headers: { cookie: `punchin_session=${sessionToken}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await runtime.app.inject({
          url: '/api/workspace',
          headers: { authorization: `Bearer ${employee.cookie.split('=')[1]}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/attendance/clock',
          headers: { ...headers, 'idempotency-key': randomUUID() },
          payload: { action: 'in' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await runtime.app.inject({ method: 'POST', url: '/api/auth/logout', headers })).statusCode,
    ).toBe(200);
    expect((await runtime.app.inject({ url: '/api/workspace', headers })).statusCode).toBe(401);
  });
  it('rate limits repeated login failures by identity', async () => {
    for (let i = 0; i < 11; i++) {
      const res = await call(null, 'POST', '/api/auth/login', {
        email: 'missing@example.test',
        password,
      });
      if (i === 10) expect(res.statusCode).toBe(429);
    }
    expect(
      (await call(null, 'POST', '/api/auth/login', { email: 'admin@example.test', password }))
        .statusCode,
    ).toBe(200);
  });
});
it('persists accounts and immutable records across database reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'punchin-db-'));
  const path = join(dir, 'data.sqlite');
  try {
    const db = openDatabase(path);
    const { Service } = await import('./service');
    const service = new Service(db, () => new Date('2026-11-09T00:00:00Z'));
    const id = await service.createAdmin('persist@example.test', '보존', password);
    const user = service.one<UserRow>('SELECT * FROM users WHERE id=?', id)!;
    service.clock(user, 'in', randomUUID());
    db.close();
    const next = openDatabase(path);
    expect(next.prepare('SELECT count(*) as n FROM attendance').get()).toMatchObject({ n: 1 });
    expect(next.prepare('SELECT count(*) as n FROM migrations').get()).toMatchObject({ n: 7 });
    next.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it('enforces administrator MFA enrollment and TOTP for later web logins', async () => {
  const { randomBytes } = await import('node:crypto');
  const OTPAuth = await import('otpauth');
  const db = openDatabase(':memory:');
  let now = new Date('2026-11-09T01:00:00Z');
  const { app, store } = await createServer({
    db,
    now: () => now,
    mfaKey: randomBytes(32).toString('base64'),
    requireAdminMfa: true,
  });
  try {
    await store.createAdmin('mfa-admin@example.test', '관리자', password);
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email: 'mfa-admin@example.test', password },
    });
    expect(first.statusCode).toBe(200);
    const headers = {
      origin,
      cookie: `punchin_session=${first.cookies[0]!.value}`,
      'x-csrf-token': first.json().csrfToken,
    };
    const invitation = { email: 'other@example.test', name: '다른 직원', team: '개발' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/invitations',
          headers,
          payload: invitation,
        })
      ).statusCode,
    ).toBe(403);
    const enrollment = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/enroll',
      headers,
      payload: { password },
    });
    expect(enrollment.statusCode).toBe(200);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(enrollment.json().secret) });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/mfa/confirm',
          headers,
          payload: { code: totp.generate({ timestamp: now.getTime() }) },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/invitations',
          headers,
          payload: invitation,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin },
          payload: { email: 'mfa-admin@example.test', password },
        })
      ).statusCode,
    ).toBe(401);
    now = new Date(now.getTime() + 30000);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin },
          payload: {
            email: 'mfa-admin@example.test',
            password,
            code: totp.generate({ timestamp: now.getTime() }),
          },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    db.close();
  }
});
