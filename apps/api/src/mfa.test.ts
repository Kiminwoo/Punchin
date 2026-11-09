import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { openDatabase } from './database';
import { Service, type UserRow } from './service';
import { Mfa, mfaKey } from './mfa';
it('encrypts MFA secrets, rejects replay, consumes recovery codes once and preserves only the enrolling session', async () => {
  const db = openDatabase(':memory:');
  let now = new Date('2026-11-09T01:00:00Z');
  const store = new Service(db, () => now);
  try {
    const id = await store.createAdmin('mfa@example.test', '관리자', 'Only-for-MFA-tests!');
    const user = store.one<UserRow>('SELECT * FROM users WHERE id=?', id)!;
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(
      'current-session-hash',
      id,
      'csrf',
      '2026-11-10T00:00:00Z',
      'web',
    );
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(
      'old-session-hash',
      id,
      'csrf',
      '2026-11-10T00:00:00Z',
      'web',
    );
    const mfa = new Mfa(store, mfaKey(randomBytes(32).toString('base64')), true);
    const enrollment = mfa.enroll(user);
    expect(
      store.one<{ secret: string }>('SELECT secret FROM mfa_enrollments')!.secret,
    ).not.toContain(enrollment.secret);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(enrollment.secret) });
    const codes = mfa.confirm(
      user,
      totp.generate({ timestamp: now.getTime() }),
      'current-session-hash',
    ).recoveryCodes;
    expect(codes).toHaveLength(8);
    expect(store.all('SELECT token_hash FROM sessions')).toEqual([
      { token_hash: 'current-session-hash' },
    ]);
    expect(mfa.status(user).enabled).toBe(true);
    expect(() => mfa.verify(user)).toThrow('입력');
    expect(() => mfa.verify(user, totp.generate({ timestamp: now.getTime() }))).toThrow('이미');
    now = new Date(now.getTime() + 30000);
    mfa.verify(user, totp.generate({ timestamp: now.getTime() }));
    mfa.verify(user, codes[0]);
    expect(() => mfa.verify(user, codes[0])).toThrow();
    mfa.disable(user, codes[1]!, 'current-session-hash');
    expect(mfa.status(user).enabled).toBe(false);
  } finally {
    db.close();
  }
});
it('refuses MFA setup without an encryption key and validates key size', async () => {
  const db = openDatabase(':memory:');
  try {
    const store = new Service(db);
    const id = await store.createAdmin('mfa@example.test', '관리자', 'Only-for-MFA-tests!');
    const user = store.one<UserRow>('SELECT * FROM users WHERE id=?', id)!;
    expect(() => new Mfa(store, null).enroll(user)).toThrow('보관');
    expect(() => mfaKey('short')).toThrow('32');
  } finally {
    db.close();
  }
});
