import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Service } from './service';
import type { SessionUser } from '@punchin/contracts';
import { transaction } from './database';
import { ApiError } from './security';
import { assertOpen } from './operations';
export const isLeave = (type: string) => ['연차', '오전 반차', '오후 반차'].includes(type);
export function leaveBalance(store: Service, userId: string) {
  const value = store.one<{ balance: number; count: number }>(
    'SELECT COALESCE(sum(minutes),0) balance,count(*) count FROM leave_ledger WHERE user_id=?',
    userId,
  )!;
  const pending = store.one<{ minutes: number }>(
    "SELECT COALESCE(sum(requested_minutes),0) minutes FROM requests WHERE user_id=? AND status='pending' AND type IN ('연차','오전 반차','오후 반차')",
    userId,
  )!.minutes;
  return { balanceMinutes: value.balance, pendingMinutes: pending, configured: value.count > 0 };
}
export function leaveDetail(store: Service, id: string) {
  return {
    ...leaveBalance(store, id),
    entries: store.all(
      'SELECT id,kind,minutes,reason,recorded_at,request_id FROM leave_ledger WHERE user_id=? ORDER BY recorded_at DESC,id DESC',
      id,
    ),
  };
}
export function adjustLeave(store: Service, actor: SessionUser, id: string, input: unknown) {
  const data = z
    .object({
      minutes: z
        .number()
        .int()
        .min(0)
        .max(480 * 366)
        .multipleOf(240),
      reason: z.string().trim().min(5).max(200),
    })
    .strict()
    .parse(input);
  return transaction(store.db, () => {
    if (!store.one("SELECT id FROM users WHERE id=? AND status='active'", id))
      throw new ApiError(404, '활성 직원을 찾을 수 없습니다.');
    const current = leaveBalance(store, id);
    if (current.balanceMinutes !== data.minutes || !current.configured) {
      store.db
        .prepare('INSERT INTO leave_ledger VALUES(?,?,?,?,?,?,?,?)')
        .run(
          randomUUID(),
          id,
          'adjustment',
          data.minutes - current.balanceMinutes,
          null,
          data.reason,
          actor.id,
          store.now().toISOString(),
        );
      store.audit(actor.id, 'leave_balance_adjusted', id, {
        previous: current.balanceMinutes,
        balance: data.minutes,
        reason: data.reason,
      });
    }
    return leaveDetail(store, id);
  });
}
export function requestedLeave(type: string, date: string, endDate: string, days?: number) {
  if (!isLeave(type)) return 0;
  if (type !== '연차') return 240;
  const maxDays = (Date.parse(endDate) - Date.parse(date)) / 86400000 + 1;
  const value = date === endDate ? 1 : days;
  if (!value || value < 1 || !Number.isInteger(value) || value > maxDays)
    throw new ApiError(400, '휴일을 제외한 실제 연차 사용일수를 입력해 주세요.');
  return value * 480;
}
export function applyLeave(
  store: Service,
  actor: SessionUser,
  request: {
    id: string;
    user_id: string;
    type: string;
    start_date: string;
    end_date: string;
    requested_minutes: number;
  },
  charged?: number,
) {
  if (!isLeave(request.type)) {
    if (charged !== undefined)
      throw new ApiError(400, '휴가 요청에서만 차감 시간을 지정할 수 있습니다.');
    return;
  }
  const amount = charged ?? request.requested_minutes;
  const maximum =
    ((Date.parse(request.end_date) - Date.parse(request.start_date)) / 86400000 + 1) * 480;
  if (
    !amount ||
    !Number.isInteger(amount) ||
    amount < 240 ||
    (request.type === '연차' ? amount % 480 !== 0 || amount > maximum : amount !== 240)
  )
    throw new ApiError(400, '연차 사용일수 또는 반차 4시간을 확인해 주세요.');
  const balance = leaveBalance(store, request.user_id);
  if (!balance.configured) throw new ApiError(409, '기초 휴가 잔액을 먼저 등록해 주세요.');
  if (balance.balanceMinutes < amount) throw new ApiError(409, '휴가 잔액이 부족합니다.');
  store.db
    .prepare('INSERT INTO leave_ledger VALUES(?,?,?,?,?,?,?,?)')
    .run(
      randomUUID(),
      request.user_id,
      'used',
      -amount,
      request.id,
      '휴가 승인',
      actor.id,
      store.now().toISOString(),
    );
  store.db.prepare('UPDATE requests SET approved_minutes=? WHERE id=?').run(amount, request.id);
}
export function requestLeaveCancellation(store: Service, user: SessionUser, id: string) {
  return transaction(store.db, () => {
    const r = store.one<{
      user_id: string;
      type: string;
      status: string;
      start_date: string;
      end_date: string;
    }>('SELECT * FROM requests WHERE id=?', id);
    if (!r || r.user_id !== user.id)
      throw new ApiError(404, '본인의 휴가 요청을 찾을 수 없습니다.');
    if (r.status !== 'approved' || !isLeave(r.type))
      throw new ApiError(409, '승인된 휴가만 취소 요청할 수 있습니다.');
    assertOpen(store, r.start_date, r.end_date);
    if (store.one('SELECT request_id FROM leave_cancellations WHERE request_id=?', id))
      throw new ApiError(409, '이미 취소 요청을 처리하고 있습니다.');
    store.db
      .prepare(
        "INSERT INTO leave_cancellations(request_id,status,requested_at) VALUES(?,'pending',?)",
      )
      .run(id, store.now().toISOString());
    store.audit(user.id, 'leave_cancellation_requested', id);
    return { ok: true };
  });
}
export function decideLeaveCancellation(
  store: Service,
  user: SessionUser,
  id: string,
  status: 'approved' | 'rejected',
  reason: string,
) {
  return transaction(store.db, () => {
    const r = store.one<{
      user_id: string;
      type: string;
      status: string;
      start_date: string;
      end_date: string;
      approved_minutes: number;
    }>('SELECT * FROM requests WHERE id=?', id);
    const c = store.one<{ status: string }>(
      'SELECT status FROM leave_cancellations WHERE request_id=?',
      id,
    );
    if (!r || c?.status !== 'pending' || r.status !== 'approved')
      throw new ApiError(409, '처리 가능한 취소 요청이 없습니다.');
    if (r.user_id === user.id)
      throw new ApiError(403, '본인 휴가 취소는 다른 관리자가 처리해야 합니다.');
    assertOpen(store, r.start_date, r.end_date);
    if (status === 'rejected' && !reason.trim())
      throw new ApiError(400, '반려 사유를 입력해 주세요.');
    if (status === 'approved') {
      if (!r.approved_minutes) throw new ApiError(409, '기존 휴가 차감 내역을 먼저 확인해 주세요.');
      store.db
        .prepare('INSERT INTO leave_ledger VALUES(?,?,?,?,?,?,?,?)')
        .run(
          randomUUID(),
          r.user_id,
          'refunded',
          r.approved_minutes,
          id,
          '휴가 취소 승인',
          user.id,
          store.now().toISOString(),
        );
      store.db.prepare("UPDATE requests SET status='cancelled' WHERE id=?").run(id);
    }
    store.db
      .prepare(
        'UPDATE leave_cancellations SET status=?,decided_at=?,decided_by=?,reason=? WHERE request_id=?',
      )
      .run(status, store.now().toISOString(), user.id, reason, id);
    store.audit(user.id, `leave_cancellation_${status}`, id, { reason });
    return { ok: true };
  });
}
