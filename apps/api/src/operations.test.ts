import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database';
import { Service, type UserRow } from './service';
import {
  monthlyReport,
  closeMonth,
  reopenMonth,
  issueReset,
  resetPassword,
  exportReport,
} from './operations';
import {
  adjustLeave,
  leaveBalance,
  requestLeaveCancellation,
  decideLeaveCancellation,
} from './leave';
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of databases) db.close();
  databases.length = 0;
});
async function fixture() {
  const db = openDatabase(':memory:');
  databases.push(db);
  let now = new Date('2026-11-09T01:00:00Z');
  const store = new Service(db, () => now);
  const adminId = await store.createAdmin('admin@example.test', '관리자', 'Test-only-password-42!');
  const admin = store.one<UserRow>('SELECT * FROM users WHERE id=?', adminId)!;
  const invite = store.invite(admin, { email: 'staff@example.test', name: '직원', team: '개발' });
  const employee = await store.activate(invite.token, 'Test-only-password-42!');
  return {
    db,
    store,
    admin,
    employee,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}
describe('leave ledger', () => {
  it('requires a configured balance, debits 8h/4h once, and credits only approved cancellation', async () => {
    const { store, admin, employee } = await fixture();
    const first = store.createRequest(employee, {
      type: '연차',
      date: '2026-11-10',
      endDate: '2026-11-10',
      reason: '',
    });
    expect(() => store.decide(admin, first.id, 'approved', '')).toThrow('기초');
    adjustLeave(store, admin, employee.id, { minutes: 4800, reason: '기존 잔여 연차 이관' });
    store.decide(admin, first.id, 'approved', '');
    expect(leaveBalance(store, employee.id).balanceMinutes).toBe(4320);
    expect(() => store.decide(admin, first.id, 'approved', '')).toThrow('처리된');
    requestLeaveCancellation(store, employee, first.id);
    expect(leaveBalance(store, employee.id).balanceMinutes).toBe(4320);
    decideLeaveCancellation(store, admin, first.id, 'approved', '일정 취소 확인');
    expect(leaveBalance(store, employee.id).balanceMinutes).toBe(4800);
    expect(() => decideLeaveCancellation(store, admin, first.id, 'approved', '중복')).toThrow();
    const half = store.createRequest(employee, {
      type: '오전 반차',
      date: '2026-11-11',
      endDate: '2026-11-11',
      reason: '',
    });
    store.decide(admin, half.id, 'approved', '');
    expect(leaveBalance(store, employee.id).balanceMinutes).toBe(4560);
  });
  it('does not guess multi-day working days and blocks insufficient balances atomically', async () => {
    const { store, admin, employee } = await fixture();
    adjustLeave(store, admin, employee.id, { minutes: 480, reason: '기초 하루만 등록' });
    expect(() =>
      store.createRequest(employee, {
        type: '연차',
        date: '2026-11-13',
        endDate: '2026-11-16',
        reason: '',
      }),
    ).toThrow();
    const request = store.createRequest(employee, {
      type: '연차',
      date: '2026-11-13',
      endDate: '2026-11-16',
      reason: '주말 제외',
      leaveDays: 2,
    });
    expect(() => store.decide(admin, request.id, 'approved', '')).toThrow('부족');
    expect(leaveBalance(store, employee.id).balanceMinutes).toBe(480);
    expect(store.requests(employee)[0]!.status).toBe('pending');
    expect(() => store.db.exec('DELETE FROM leave_ledger')).toThrow('immutable');
  });
  it('keeps leave cancellation pending in month-close checks', async () => {
    const { store, admin, employee, setNow } = await fixture();
    adjustLeave(store, admin, employee.id, { minutes: 960, reason: '기초 이틀 등록' });
    const request = store.createRequest(employee, {
      type: '연차',
      date: '2026-10-20',
      endDate: '2026-10-20',
      reason: '',
    });
    store.decide(admin, request.id, 'approved', '');
    requestLeaveCancellation(store, employee, request.id);
    setNow('2026-10-21T00:00:00Z');
    store.clock(employee, 'in', randomUUID());
    setNow('2026-10-21T09:30:00Z');
    store.clock(employee, 'out', randomUUID());
    setNow('2026-11-09T01:00:00Z');
    expect(() => closeMonth(store, admin, '2026-10')).toThrow('대기');
  });
});
describe('month closure and recovery', () => {
  it('persists a close snapshot, prevents edits, and keeps versions when reopened', async () => {
    const { store, admin, employee, setNow } = await fixture();
    setNow('2026-10-30T00:00:00Z');
    store.clock(employee, 'in', randomUUID());
    setNow('2026-10-30T09:30:00Z');
    store.clock(employee, 'out', randomUUID());
    setNow('2026-11-09T01:00:00Z');
    expect(monthlyReport(store, '2026-10').summary.minutes).toBe(480);
    const closed = closeMonth(store, admin, '2026-10');
    expect(closed.version).toBe(1);
    expect(() =>
      store.createRequest(employee, {
        type: '기록 정정',
        date: '2026-10-30',
        endDate: '2026-10-30',
        time: '08:30',
        reason: '추가 확인',
      }),
    ).toThrow('마감');
    expect(() => reopenMonth(store, admin, '2026-10', '짧음')).toThrow();
    reopenMonth(store, admin, '2026-10', '정정 요청 추가 확인');
    const request = store.createRequest(employee, {
      type: '기록 정정',
      date: '2026-10-30',
      endDate: '2026-10-30',
      time: '08:30',
      reason: '실제 출근 확인',
    });
    expect(() => closeMonth(store, admin, '2026-10')).toThrow('대기');
    store.decide(admin, request.id, 'approved', '');
    expect(closeMonth(store, admin, '2026-10').version).toBe(2);
    expect(monthlyReport(store, '2026-10').summary.minutes).toBe(510);
    expect(
      store.one<{ n: number }>("SELECT count(*) n FROM month_history WHERE action='closed'")!.n,
    ).toBe(2);
    expect(exportReport(store, admin, '2026-10').csv).toContain('원본 출근');
  });
  it('blocks incomplete/current months and sanitizes spreadsheet formula names', async () => {
    const { store, admin, employee, setNow } = await fixture();
    setNow('2026-10-30T00:00:00Z');
    store.clock(employee, 'in', randomUUID());
    setNow('2026-11-09T01:00:00Z');
    expect(() => closeMonth(store, admin, '2026-10')).toThrow('누락');
    expect(() => closeMonth(store, admin, '2026-11')).toThrow('현재');
    store.db.prepare('UPDATE users SET name=? WHERE id=?').run('=HYPERLINK("x")', employee.id);
    expect(exportReport(store, admin, '2026-10').csv).toContain("'=HYPERLINK");
  });
  it('requires reset tokens once, revokes access and does not accept expired or disabled-account tokens', async () => {
    const { store, admin, employee, setNow } = await fixture();
    const reset = issueReset(store, admin, employee.id);
    expect(store.one<UserRow>('SELECT * FROM users WHERE id=?', employee.id)!.reset_required).toBe(
      1,
    );
    const updated = await resetPassword(store, reset.token, 'Replacement-password-42!');
    expect(updated.reset_required).toBe(0);
    await expect(resetPassword(store, reset.token, 'Replacement-password-42!')).rejects.toThrow(
      '만료',
    );
    const expired = issueReset(store, admin, employee.id);
    setNow('2026-11-09T02:00:00Z');
    await expect(resetPassword(store, expired.token, 'Replacement-password-42!')).rejects.toThrow(
      '만료',
    );
    const fresh = issueReset(store, admin, employee.id);
    store.deactivate(admin, employee.id);
    await expect(resetPassword(store, fresh.token, 'Replacement-password-42!')).rejects.toThrow();
    expect(() => issueReset(store, admin, admin.id)).toThrow('본인');
  });
});
