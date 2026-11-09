import { leaveBalance, requestedLeave, applyLeave } from './leave';
import { assertOpen } from './operations';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  POLICY_VERSION,
  invitationSchema,
  passwordSchema,
  requestSchema,
  officeSchema,
} from '@punchin/contracts';
import type {
  SessionUser,
  Snapshot,
  RecordView,
  RequestView,
  Person,
  Office,
  locationSchema,
} from '@punchin/contracts';
import { koreaDate, koreaMinute, formatTime, parseTime, POLICY } from '@punchin/domain';
import { transaction } from './database';
import type { z } from 'zod';
import { verifyLocation } from './location';
import { ApiError, digest, hashPassword, token } from './security';
export type UserRow = SessionUser & {
  status: 'active' | 'inactive' | 'invited';
  password_hash: string | null;
  reset_required: number;
};
type AttendanceRow = {
  id: string;
  user_id: string;
  work_date: string;
  start_at: string | null;
  end_at: string | null;
  corrected_start: string | null;
  corrected_end: string | null;
  version: number;
};
type RequestRow = {
  id: string;
  user_id: string;
  name: string;
  type: RequestView['type'];
  start_date: string;
  end_date: string;
  reason: string;
  time: string | null;
  status: RequestView['status'];
  created_at: string;
  decision_reason: string | null;
  base_version: number;
  field: 'start' | 'end';
  requested_minutes: number;
  approved_minutes: number | null;
  cancellation_status?: 'pending' | 'approved' | 'rejected';
  cancellation_reason?: string;
};
export class Service {
  constructor(
    public db: DatabaseSync,
    public now: () => Date = () => new Date(),
  ) {}
  one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  audit(actor: string, action: string, subject: string, detail: object = {}) {
    this.db
      .prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), actor, action, subject, JSON.stringify(detail), this.now().toISOString());
  }
  async createAdmin(email: string, name: string, password: string) {
    passwordSchema.parse(password);
    const hash = await hashPassword(password);
    return transaction(this.db, () => {
      if (this.one('SELECT id FROM users LIMIT 1'))
        throw new ApiError(409, '초기 계정이 이미 존재합니다. 관리자 초대를 사용해 주세요.');
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO users(id,email,name,team,role,status,password_hash,created_at) VALUES(?,?,?,?,?,'active',?,?)",
        )
        .run(id, email, name, '운영', 'admin', hash, this.now().toISOString());
      this.audit(id, 'admin_bootstrapped', id);
      return id;
    });
  }
  invite(actor: SessionUser, input: unknown) {
    const data = invitationSchema.parse(input);
    const secret = token();
    const id = randomUUID();
    const expiresAt = new Date(this.now().getTime() + 72 * 3600000).toISOString();
    transaction(this.db, () => {
      if (this.one('SELECT id FROM users WHERE email=?', data.email))
        throw new ApiError(409, '이미 등록된 이메일입니다.');
      if (
        this.one<{ count: number }>(
          "SELECT count(*) as count FROM users WHERE status != 'inactive'",
        )!.count >= 20
      )
        throw new ApiError(409, '현재 설정은 활성·초대 직원 합계 20명까지입니다.');
      this.db
        .prepare(
          "INSERT INTO users(id,email,name,team,role,status,password_hash,created_at) VALUES(?,?,?,?,?,'invited',NULL,?)",
        )
        .run(id, data.email, data.name, data.team, data.role, this.now().toISOString());
      this.db
        .prepare('INSERT INTO invitations VALUES(?,?,?,NULL)')
        .run(digest(secret), id, expiresAt);
      this.audit(actor.id, 'employee_invited', id, { role: data.role });
    });
    return { token: secret, expiresAt, userId: id };
  }
  reinvite(actor: SessionUser, id: string) {
    const secret = token();
    const expiresAt = new Date(this.now().getTime() + 72 * 3600000).toISOString();
    transaction(this.db, () => {
      const person = this.one<UserRow>('SELECT * FROM users WHERE id=?', id);
      if (!person || person.status !== 'invited')
        throw new ApiError(409, '초대 중인 직원만 코드를 재발급할 수 있습니다.');
      this.db.prepare('DELETE FROM invitations WHERE user_id=?').run(id);
      this.db
        .prepare('INSERT INTO invitations VALUES(?,?,?,NULL)')
        .run(digest(secret), id, expiresAt);
      this.audit(actor.id, 'invitation_reissued', id);
    });
    return { token: secret, expiresAt, userId: id };
  }
  async activate(secret: string, password: string) {
    const hash = await hashPassword(password);
    return transaction(this.db, () => {
      const invite = this.one<{ user_id: string }>(
        "SELECT i.user_id FROM invitations i JOIN users u ON i.user_id=u.id WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND u.status='invited'",
        digest(secret),
        this.now().toISOString(),
      );
      if (!invite) throw new ApiError(400, '초대 코드가 만료되었거나 이미 사용되었습니다.');
      this.db
        .prepare("UPDATE users SET status='active', password_hash=? WHERE id=?")
        .run(hash, invite.user_id);
      this.db
        .prepare('UPDATE invitations SET used_at=? WHERE token_hash=?')
        .run(this.now().toISOString(), digest(secret));
      this.audit(invite.user_id, 'invitation_accepted', invite.user_id);
      return this.one<UserRow>('SELECT * FROM users WHERE id=?', invite.user_id)!;
    });
  }
  deactivate(actor: SessionUser, id: string) {
    if (id === actor.id) throw new ApiError(409, '자신의 계정은 비활성화할 수 없습니다.');
    transaction(this.db, () => {
      const target = this.one<UserRow>('SELECT * FROM users WHERE id=?', id);
      if (!target) throw new ApiError(404, '직원을 찾을 수 없습니다.');
      if (
        target.role === 'admin' &&
        target.status === 'active' &&
        this.one<{ count: number }>(
          "SELECT count(*) as count FROM users WHERE role='admin' AND status='active'",
        )!.count <= 1
      )
        throw new ApiError(409, '마지막 관리자는 비활성화할 수 없습니다.');
      this.db.prepare("UPDATE users SET status='inactive' WHERE id=?").run(id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM invitations WHERE user_id=?').run(id);
      this.audit(actor.id, 'employee_deactivated', id);
    });
  }
  viewRecord(row: AttendanceRow): RecordView {
    const start =
      row.corrected_start ?? (row.start_at ? formatTime(koreaMinute(new Date(row.start_at))) : '');
    return {
      date: row.work_date,
      start,
      end: row.corrected_end ?? (row.end_at ? formatTime(koreaMinute(new Date(row.end_at))) : null),
      originalStart: row.start_at ? formatTime(koreaMinute(new Date(row.start_at))) : '',
      originalEnd: row.end_at ? formatTime(koreaMinute(new Date(row.end_at))) : null,
      corrected: !!row.corrected_start || !!row.corrected_end,
      startCorrected: !!row.corrected_start,
      endCorrected: !!row.corrected_end,
      needsReview: !!start && parseTime(start) < POLICY.earliestStart,
      userId: row.user_id,
    };
  }
  requests(user: SessionUser): RequestView[] {
    return this.all<RequestRow>(
      `SELECT r.*, u.name, c.status cancellation_status, c.reason cancellation_reason FROM requests r JOIN users u ON r.user_id=u.id LEFT JOIN leave_cancellations c ON c.request_id=r.id ${user.role === 'admin' ? '' : 'WHERE r.user_id=?'} ORDER BY r.created_at DESC, r.id DESC`,
      ...(user.role === 'admin' ? [] : [user.id]),
    ).map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      type: r.type,
      date: r.start_date,
      endDate: r.end_date,
      reason: r.reason,
      time: r.time ?? undefined,
      field: r.type === '기록 정정' ? r.field : undefined,
      status: r.status,
      createdAt: r.created_at,
      decisionReason: r.decision_reason ?? undefined,
      baseVersion: r.base_version,
      requestedMinutes: r.requested_minutes,
      approvedMinutes: r.approved_minutes ?? undefined,
      cancellationStatus: r.cancellation_status,
      cancellationReason: r.cancellation_reason,
      leaveDays: r.type === '연차' && r.requested_minutes ? r.requested_minutes / 480 : undefined,
    }));
  }
  snapshot(user: SessionUser): Snapshot {
    const date = koreaDate(this.now());
    const records = this.all<AttendanceRow>(
      'SELECT * FROM attendance WHERE user_id=? ORDER BY work_date DESC',
      user.id,
    ).map((r) => this.viewRecord(r));
    const requests = this.requests(user);
    const people = this.all<UserRow>(
      `SELECT * FROM users ${user.role === 'admin' ? '' : "WHERE status='active'"} ORDER BY created_at, id`,
    ).map((person, index): Person => {
      const record = this.one<AttendanceRow>(
        'SELECT * FROM attendance WHERE user_id=? AND work_date=?',
        person.id,
        date,
      );
      const schedule = this.one<{ type: string }>(
        "SELECT type FROM requests WHERE user_id=? AND status='approved' AND start_date<=? AND end_date>=? AND type!='기록 정정' ORDER BY created_at DESC LIMIT 1",
        person.id,
        date,
        date,
      );
      const state =
        person.status === 'invited'
          ? '초대 중'
          : person.status === 'inactive'
            ? '비활성'
            : schedule && schedule.type !== '외근'
              ? '휴가'
              : record?.end_at || record?.corrected_end
                ? '퇴근'
                : schedule?.type === '외근'
                  ? '외근'
                  : record
                    ? '근무 중'
                    : '미출근';
      return {
        id: person.id,
        name: person.name,
        team: person.team,
        role: person.role,
        roleLabel: person.role === 'admin' ? '관리자' : '직원',
        status: person.status,
        email: user.role === 'admin' ? person.email : undefined,
        start:
          record && (user.role === 'admin' || user.id === person.id)
            ? this.viewRecord(record).start
            : '—',
        state,
        color: ['sage', 'peach', 'lavender', 'sand', 'blue'][index % 5]!,
      };
    });
    return {
      version: 1,
      day: records.find((r) => r.date === date) ?? { date, start: '', end: null },
      history: records.filter((r) => r.date !== date),
      requests,
      people,
      user: { id: user.id, name: user.name, email: user.email, team: user.team, role: user.role },
      serverNow: this.now().toISOString(),
      policyVersion: POLICY_VERSION,
      locationVerification: this.office().enabled ? 'enabled' : 'not_configured',
      office: this.office(),
      leave: leaveBalance(this, user.id),
    };
  }
  office(): Office {
    return JSON.parse(
      this.one<{ config: string }>('SELECT config FROM office WHERE id=1')!.config,
    ) as Office;
  }
  updateOffice(actor: SessionUser, input: unknown) {
    const data = officeSchema.parse(input);
    return transaction(this.db, () => {
      const next = { ...data, revision: this.office().revision + 1 };
      this.db.prepare('UPDATE office SET config=? WHERE id=1').run(JSON.stringify(next));
      this.audit(actor.id, 'office_updated', 'office', {
        revision: next.revision,
        enabled: next.enabled,
      });
      return next;
    });
  }
  clock(
    user: SessionUser,
    action: 'in' | 'out',
    key: string,
    location?: z.infer<typeof locationSchema>,
  ) {
    return transaction(this.db, () => {
      const previous = this.one<{ fingerprint: string; response: string }>(
        'SELECT * FROM idempotency WHERE user_id=? AND key=?',
        user.id,
        key,
      );
      if (previous) {
        if (previous.fingerprint !== action)
          throw new ApiError(409, '같은 요청 키를 다른 작업에 사용할 수 없습니다.');
        return JSON.parse(previous.response) as { action: string; recordedAt: string };
      }
      const now = this.now();
      const date = koreaDate(now);
      const iso = now.toISOString();
      assertOpen(this, date);
      const office = this.office();
      const fieldwork = this.one(
        "SELECT id FROM requests WHERE user_id=? AND type='외근' AND status='approved' AND start_date<=? AND end_date>=?",
        user.id,
        date,
        date,
      );
      const verification = fieldwork
        ? { verification: 'approved_fieldwork', evidence: { officeRevision: office.revision } }
        : verifyLocation(office, location, now);
      let record = this.one<AttendanceRow>(
        'SELECT * FROM attendance WHERE user_id=? AND work_date=?',
        user.id,
        date,
      );
      if (action === 'in') {
        if (record) throw new ApiError(409, '오늘의 출근 기록이 이미 있습니다.');
        if (
          this.one(
            'SELECT id FROM attendance WHERE user_id=? AND end_at IS NULL AND corrected_end IS NULL',
            user.id,
          )
        )
          throw new ApiError(409, '이전 근무의 퇴근 누락을 먼저 담당자에게 확인해 주세요.');
        const id = randomUUID();
        this.db
          .prepare(
            'INSERT INTO attendance(id,user_id,work_date,start_at,policy_version,verification) VALUES(?,?,?,?,?,?)',
          )
          .run(
            id,
            user.id,
            date,
            iso,
            `${POLICY_VERSION}/office-${office.revision}`,
            verification.verification,
          );
        record = this.one<AttendanceRow>('SELECT * FROM attendance WHERE id=?', id)!;
      } else {
        if (!record || record.end_at || record.corrected_end)
          throw new ApiError(409, '퇴근을 기록할 수 있는 오늘의 근무가 없습니다.');
        const start = record.corrected_start
          ? parseTime(record.corrected_start)
          : koreaMinute(new Date(record.start_at!));
        if (start > koreaMinute(now)) throw new ApiError(409, '출근 이후 시각으로 기록해 주세요.');
        this.db
          .prepare(
            'UPDATE attendance SET end_at=?, version=version+1 WHERE id=? AND end_at IS NULL AND corrected_end IS NULL',
          )
          .run(iso, record.id);
      }
      this.db
        .prepare(
          'INSERT INTO events(id,user_id,action,recorded_at,attendance_id,policy_version,verification,evidence) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          user.id,
          action === 'in' ? 'clock_in' : 'clock_out',
          iso,
          record.id,
          `${POLICY_VERSION}/office-${office.revision}`,
          verification.verification,
          JSON.stringify(verification.evidence),
        );
      this.audit(user.id, action === 'in' ? 'clock_in' : 'clock_out', record.id);
      const response = { action, recordedAt: iso };
      this.db
        .prepare('INSERT INTO idempotency VALUES(?,?,?,?)')
        .run(user.id, key, action, JSON.stringify(response));
      return response;
    });
  }
  createRequest(user: SessionUser, input: unknown) {
    const data = requestSchema.parse(input);
    if (
      data.type === '기록 정정' &&
      (data.date > koreaDate(this.now()) ||
        (data.date === koreaDate(this.now()) && parseTime(data.time!) > koreaMinute(this.now())))
    )
      throw new ApiError(400, '미래 시각으로 정정할 수 없습니다.');
    return transaction(this.db, () => {
      assertOpen(this, data.date, data.endDate);
      if (
        ['연차', '오전 반차', '오후 반차'].includes(data.type) &&
        this.one(
          "SELECT id FROM requests WHERE user_id=? AND type IN ('연차','오전 반차','오후 반차') AND status IN ('pending','approved') AND start_date<=? AND end_date>=?",
          user.id,
          data.endDate,
          data.date,
        )
      )
        throw new ApiError(409, '겹치는 휴가 요청이 있습니다. 기존 요청을 확인해 주세요.');
      const base =
        this.one<{ version: number }>(
          'SELECT version FROM attendance WHERE user_id=? AND work_date=?',
          user.id,
          data.date,
        )?.version ?? 0;
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO requests(id,user_id,type,start_date,end_date,reason,time,created_at,base_version,field,requested_minutes) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          user.id,
          data.type,
          data.date,
          data.endDate,
          data.reason,
          data.time ?? null,
          this.now().toISOString(),
          base,
          data.field ?? 'start',
          requestedLeave(data.type, data.date, data.endDate, data.leaveDays),
        );
      this.audit(user.id, 'request_created', id, { type: data.type });
      return { id };
    });
  }
  decide(
    user: SessionUser,
    id: string,
    status: 'approved' | 'rejected' | 'cancelled',
    reason: string,
    chargedMinutes?: number,
  ) {
    transaction(this.db, () => {
      const request = this.one<RequestRow>('SELECT * FROM requests WHERE id=?', id);
      if (!request || (user.role !== 'admin' && request.user_id !== user.id))
        throw new ApiError(404, '요청을 찾을 수 없습니다.');
      assertOpen(this, request.start_date, request.end_date);
      if (request.status !== 'pending')
        throw new ApiError(409, '이미 처리된 요청입니다. 새로고침해 주세요.');
      if (status === 'cancelled' ? request.user_id !== user.id : user.role !== 'admin')
        throw new ApiError(403, '처리 권한이 없습니다.');
      if (status !== 'cancelled' && request.user_id === user.id)
        throw new ApiError(403, '본인의 요청은 다른 관리자가 처리해야 합니다.');
      if (status === 'approved' && request.type === '기록 정정') {
        const record = this.one<AttendanceRow>(
          'SELECT * FROM attendance WHERE user_id=? AND work_date=?',
          request.user_id,
          request.start_date,
        );
        if ((record?.version ?? 0) !== request.base_version)
          throw new ApiError(
            409,
            '신청 이후 근태 기록이 변경되었습니다. 새 정정 요청이 필요합니다.',
          );
        const start =
          record?.corrected_start ??
          (record?.start_at ? formatTime(koreaMinute(new Date(record.start_at))) : null);
        const end =
          record?.corrected_end ??
          (record?.end_at ? formatTime(koreaMinute(new Date(record.end_at))) : null);
        if (request.field === 'end') {
          if (!record || !start) throw new ApiError(400, '출근 기록을 먼저 등록·정정해 주세요.');
          if (parseTime(request.time!) < parseTime(start))
            throw new ApiError(400, '퇴근 정정 시각이 출근보다 빠릅니다.');
          this.db
            .prepare('UPDATE attendance SET corrected_end=?,version=version+1 WHERE id=?')
            .run(request.time, record.id);
        } else {
          if (end && parseTime(request.time!) > parseTime(end))
            throw new ApiError(400, '출근 정정 시각이 퇴근보다 늦습니다.');
          if (record)
            this.db
              .prepare('UPDATE attendance SET corrected_start=?,version=version+1 WHERE id=?')
              .run(request.time, record.id);
          else
            this.db
              .prepare(
                'INSERT INTO attendance(id,user_id,work_date,corrected_start,policy_version) VALUES(?,?,?,?,?)',
              )
              .run(randomUUID(), request.user_id, request.start_date, request.time, POLICY_VERSION);
        }
        this.audit(user.id, 'correction_applied', id, {
          originalStart: record?.start_at ?? null,
          originalEnd: record?.end_at ?? null,
          field: request.field,
          previousEnd: record?.corrected_end ?? null,
          previousCorrection: record?.corrected_start ?? null,
          requestedStart: request.time,
        });
      }
      if (status === 'approved') applyLeave(this, user, request, chargedMinutes);
      this.db
        .prepare(
          "UPDATE requests SET status=?, decided_at=?, decided_by=?, decision_reason=? WHERE id=? AND status='pending'",
        )
        .run(status, this.now().toISOString(), user.id, reason, id);
      this.audit(user.id, `request_${status}`, id, { reason });
    });
  }
}
