import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import type { Service, UserRow } from './service';
import { ApiError, digest } from './security';
import { transaction } from './database';
export function mfaKey(value: string | undefined) {
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY는 32바이트 base64 키여야 합니다.');
  return key;
}
export class Mfa {
  constructor(
    private store: Service,
    private key: Buffer | null,
    public required = false,
  ) {}
  private seal(value: string) {
    if (!this.key) throw new ApiError(503, '관리자 인증 보관 설정이 필요합니다.');
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
  }
  private open(value: string) {
    if (!this.key) throw new ApiError(503, '관리자 인증 보관 설정이 필요합니다.');
    const [iv, tag, data] = value.split('.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv!, 'base64'));
    decipher.setAuthTag(Buffer.from(tag!, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data!, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
  private totp(secret: string, user: UserRow) {
    return new OTPAuth.TOTP({
      issuer: 'Punchin',
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
  }
  status(user: UserRow) {
    return {
      configured: !!this.key,
      required: this.required,
      enabled: !!this.store.one<{ enabled: number }>(
        'SELECT enabled FROM mfa_accounts WHERE user_id=?',
        user.id,
      )?.enabled,
    };
  }
  enroll(user: UserRow) {
    if (this.status(user).enabled) throw new ApiError(409, '기존 인증을 먼저 해제해 주세요.');
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    this.store.db
      .prepare(
        'INSERT INTO mfa_enrollments VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at',
      )
      .run(
        user.id,
        this.seal(secret),
        new Date(this.store.now().getTime() + 10 * 60000).toISOString(),
      );
    return { secret, uri: this.totp(secret, user).toString() };
  }
  confirm(user: UserRow, code: string, sessionHash: string) {
    return transaction(this.store.db, () => {
      const pending = this.store.one<{ secret: string }>(
        'SELECT secret FROM mfa_enrollments WHERE user_id=? AND expires_at>?',
        user.id,
        this.store.now().toISOString(),
      );
      if (!pending) throw new ApiError(400, '인증 등록이 만료되었습니다. 다시 시작해 주세요.');
      const totp = this.totp(this.open(pending.secret), user),
        delta = totp.validate({ token: code, timestamp: this.store.now().getTime(), window: 1 });
      if (delta === null) throw new ApiError(400, '인증앱 코드를 확인해 주세요.');
      const counter = Math.floor(this.store.now().getTime() / 30000) + delta;
      this.store.db
        .prepare(
          'INSERT INTO mfa_accounts VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,enabled=1,last_counter=excluded.last_counter',
        )
        .run(user.id, pending.secret, counter);
      this.store.db.prepare('DELETE FROM mfa_enrollments WHERE user_id=?').run(user.id);
      this.store.db.prepare('DELETE FROM mfa_recovery WHERE user_id=?').run(user.id);
      const codes = Array.from({ length: 8 }, () => randomBytes(9).toString('hex').toUpperCase());
      for (const value of codes)
        this.store.db
          .prepare('INSERT INTO mfa_recovery VALUES(?,?,NULL)')
          .run(digest(value), user.id);
      this.store.db
        .prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=?')
        .run(user.id, sessionHash);
      this.store.audit(user.id, 'mfa_enabled', user.id);
      return { recoveryCodes: codes.map((value) => value.match(/.{6}/g)!.join('-')) };
    });
  }
  verify(user: UserRow, code?: string) {
    const account = this.store.one<{ secret: string; enabled: number; last_counter: number }>(
      'SELECT * FROM mfa_accounts WHERE user_id=?',
      user.id,
    );
    if (!account?.enabled) return;
    if (!code) throw new ApiError(401, '인증앱 코드 또는 복구 코드를 입력해 주세요.');
    const normalized = code.replaceAll('-', '').toUpperCase();
    if (/^[A-F0-9]{18}$/.test(normalized)) {
      const updated = this.store.db
        .prepare(
          'UPDATE mfa_recovery SET used_at=? WHERE token_hash=? AND user_id=? AND used_at IS NULL',
        )
        .run(this.store.now().toISOString(), digest(normalized), user.id);
      if (updated.changes === 1) {
        this.store.audit(user.id, 'mfa_recovery_used', user.id);
        return;
      }
    }
    const delta = this.totp(this.open(account.secret), user).validate({
      token: code,
      timestamp: this.store.now().getTime(),
      window: 1,
    });
    const counter = delta === null ? -1 : Math.floor(this.store.now().getTime() / 30000) + delta;
    if (counter <= account.last_counter)
      throw new ApiError(401, '인증앱 코드가 잘못되었거나 이미 사용되었습니다.');
    const result = this.store.db
      .prepare('UPDATE mfa_accounts SET last_counter=? WHERE user_id=? AND last_counter<?')
      .run(counter, user.id, counter);
    if (result.changes !== 1) throw new ApiError(401, '새 인증앱 코드를 입력해 주세요.');
  }
  disable(user: UserRow, code: string, sessionHash: string) {
    return transaction(this.store.db, () => {
      this.verify(user, code);
      this.store.db.prepare('DELETE FROM mfa_accounts WHERE user_id=?').run(user.id);
      this.store.db.prepare('DELETE FROM mfa_recovery WHERE user_id=?').run(user.id);
      this.store.db.prepare('DELETE FROM mfa_enrollments WHERE user_id=?').run(user.id);
      this.store.db
        .prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=?')
        .run(user.id, sessionHash);
      this.store.audit(user.id, 'mfa_disabled', user.id);
      return { ok: true };
    });
  }
}
