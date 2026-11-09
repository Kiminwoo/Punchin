import type { MonthlyReport } from '@punchin/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SessionUser } from '@punchin/contracts';
import { POLICY_VERSION } from '@punchin/contracts';
import { koreaDate, parseTime, workedMinutes } from '@punchin/domain';
import type { Service, UserRow } from './service';
import { transaction } from './database';
import { ApiError, digest, hashPassword, token } from './security';
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, '올바른 조회 월을 선택해 주세요.');
export function assertOpen(store: Service, date: string, endDate = date) {
  if (
    store.one(
      "SELECT month FROM month_closures WHERE state='closed' AND month>=? AND month<=?",
      date.slice(0, 7),
      endDate.slice(0, 7),
    )
  )
    throw new ApiError(409, '마감된 월의 기록입니다. 관리자 재개방이 필요합니다.');
}
export function monthlyReport(store: Service, month: string): MonthlyReport {
  monthSchema.parse(month);
  const closure = store.one<{
    state: string;
    version: number;
    snapshot: string | null;
    closed_at: string;
    closed_by: string;
  }>('SELECT * FROM month_closures WHERE month=?', month);
  if (closure?.state === 'closed' && closure.snapshot)
    return JSON.parse(closure.snapshot) as MonthlyReport;
  const records = store.all<Parameters<Service['viewRecord']>[0] & { name: string; team: string }>(
    'SELECT a.*,u.name,u.team FROM attendance a JOIN users u ON u.id=a.user_id WHERE substr(work_date,1,7)=? ORDER BY work_date,u.name,a.user_id',
    month,
  );
  const rows = records.map((record) => {
    const r = store.viewRecord(record);
    return {
      userId: record.user_id,
      name: record.name,
      team: record.team,
      date: r.date,
      start: r.start,
      end: r.end,
      originalStart: r.originalStart ?? '',
      originalEnd: r.originalEnd ?? null,
      minutes: r.start && r.end ? workedMinutes(parseTime(r.start), parseTime(r.end)) : null,
      needsReview: !!r.needsReview,
      corrected: !!r.corrected,
    };
  });
  const pending = store.one<{ n: number }>(
    "SELECT count(*) n FROM requests WHERE status='pending' AND substr(start_date,1,7)<=? AND substr(end_date,1,7)>=?",
    month,
    month,
  )!.n;
  return {
    month,
    state: 'open',
    version: closure?.version ?? 0,
    generatedAt: store.now().toISOString(),
    policyVersion: POLICY_VERSION,
    rows,
    summary: {
      employees: new Set(rows.map((r) => r.userId)).size,
      records: rows.length,
      minutes: rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0),
      incomplete: rows.filter((r) => r.minutes === null || r.needsReview).length,
      pending:
        pending +
        store.one<{ n: number }>(
          "SELECT count(*) n FROM leave_cancellations c JOIN requests r ON r.id=c.request_id WHERE c.status='pending' AND substr(r.start_date,1,7)<=? AND substr(r.end_date,1,7)>=?",
          month,
          month,
        )!.n,
    },
  };
}
export function closeMonth(store: Service, user: SessionUser, month: string) {
  monthSchema.parse(month);
  return transaction(store.db, () => {
    if (month >= koreaDate(store.now()).slice(0, 7))
      throw new ApiError(409, '현재 월과 미래 월은 마감할 수 없습니다.');
    const report = monthlyReport(store, month);
    if (report.state === 'closed') throw new ApiError(409, '이미 마감된 월입니다.');
    if (!report.rows.length) throw new ApiError(409, '마감할 근태 기록이 없습니다.');
    if (report.summary.incomplete || report.summary.pending)
      throw new ApiError(409, '누락·확인 필요 기록과 대기 요청을 먼저 처리해 주세요.');
    const snapshot: MonthlyReport = {
      ...report,
      state: 'closed',
      version: report.version + 1,
      closedAt: store.now().toISOString(),
      closedBy: user.id,
    };
    store.db
      .prepare(
        "INSERT INTO month_closures(month,state,version,snapshot,closed_at,closed_by) VALUES(?,'closed',?,?,?,?) ON CONFLICT(month) DO UPDATE SET state='closed',version=excluded.version,snapshot=excluded.snapshot,closed_at=excluded.closed_at,closed_by=excluded.closed_by",
      )
      .run(month, snapshot.version, JSON.stringify(snapshot), snapshot.closedAt!, user.id);
    store.db
      .prepare('INSERT INTO month_history VALUES(?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        month,
        snapshot.version,
        'closed',
        JSON.stringify(snapshot),
        user.id,
        store.now().toISOString(),
      );
    store.audit(user.id, 'month_closed', month, { version: snapshot.version });
    return snapshot;
  });
}
export function reopenMonth(store: Service, user: SessionUser, month: string, reason: string) {
  monthSchema.parse(month);
  z.string().trim().min(5, '재개방 사유를 5자 이상 입력해 주세요.').max(200).parse(reason);
  transaction(store.db, () => {
    const closure = store.one<{ state: string; version: number }>(
      'SELECT state,version FROM month_closures WHERE month=?',
      month,
    );
    if (closure?.state !== 'closed') throw new ApiError(409, '마감된 월이 아닙니다.');
    store.db.prepare("UPDATE month_closures SET state='open' WHERE month=?").run(month);
    store.db
      .prepare('INSERT INTO month_history VALUES(?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        month,
        closure.version,
        'reopened',
        JSON.stringify({ reason }),
        user.id,
        store.now().toISOString(),
      );
    store.audit(user.id, 'month_reopened', month, { reason, version: closure.version });
  });
}
function cell(value: string) {
  const safe = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportReport(store: Service, user: SessionUser, month: string) {
  const report = monthlyReport(store, month);
  store.audit(user.id, 'report_exported', month, { version: report.version, state: report.state });
  const rows = [
    [
      '직원',
      '팀',
      '날짜',
      '출근',
      '퇴근',
      '원본 출근',
      '원본 퇴근',
      '실근무(분)',
      '정정',
      '확인 필요',
    ],
    ...report.rows.map((r) => [
      r.name,
      r.team,
      r.date,
      r.start,
      r.end ?? '',
      r.originalStart,
      r.originalEnd ?? '',
      r.minutes?.toString() ?? '',
      r.corrected ? 'Y' : 'N',
      r.needsReview ? 'Y' : 'N',
    ]),
  ];
  return {
    filename: `punchin-${month}-v${report.version}.csv`,
    csv: '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n'),
  };
}
export function issueReset(store: Service, user: SessionUser, id: string) {
  if (user.id === id)
    throw new ApiError(409, '본인 비밀번호 재설정은 다른 관리자가 발급해야 합니다.');
  const secret = token(),
    expiresAt = new Date(store.now().getTime() + 30 * 60000).toISOString();
  transaction(store.db, () => {
    const target = store.one<UserRow>('SELECT * FROM users WHERE id=?', id);
    if (target?.status !== 'active') throw new ApiError(404, '활성 직원을 찾을 수 없습니다.');
    store.db.prepare('DELETE FROM password_resets WHERE user_id=?').run(id);
    store.db
      .prepare('INSERT INTO password_resets VALUES(?,?,?,NULL)')
      .run(digest(secret), id, expiresAt);
    store.db.prepare('UPDATE users SET reset_required=1 WHERE id=?').run(id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    store.audit(user.id, 'password_reset_issued', id);
  });
  return { token: secret, expiresAt };
}
export async function resetPassword(
  store: Service,
  secret: string,
  password: string,
  verify?: (user: UserRow) => void,
) {
  const hash = await hashPassword(password);
  return transaction(store.db, () => {
    const row = store.one<{ user_id: string }>(
      "SELECT p.user_id FROM password_resets p JOIN users u ON p.user_id=u.id WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND u.status='active'",
      digest(secret),
      store.now().toISOString(),
    );
    if (!row) throw new ApiError(400, '재설정 코드가 만료되었거나 사용되었습니다.');
    if (verify) verify(store.one<UserRow>('SELECT * FROM users WHERE id=?', row.user_id)!);
    store.db
      .prepare('UPDATE users SET password_hash=?,reset_required=0 WHERE id=?')
      .run(hash, row.user_id);
    store.db
      .prepare('UPDATE password_resets SET used_at=? WHERE token_hash=?')
      .run(store.now().toISOString(), digest(secret));
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
    store.audit(row.user_id, 'password_reset_completed', row.user_id);
    return store.one<UserRow>('SELECT * FROM users WHERE id=?', row.user_id)!;
  });
}
