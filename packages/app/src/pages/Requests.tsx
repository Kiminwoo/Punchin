import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  FilePenLine,
  Plus,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { requestSchema } from '@punchin/contracts';
import { Badge, Button, Card, EmptyState, cn } from '@punchin/ui';
import { today, dateLabel } from '../demo';
import type { Request } from '../types';
import { statusLabel, statusTone } from '../request-status';
import { Modal } from '../components/Primitives';
export function RequestPanel({
  requests,
  compact = false,
  onNew,
  admin = false,
  onStatus,
  live = false,
  currentUserId,
  busy = false,
}: {
  requests: Request[];
  compact?: boolean;
  onNew: () => void;
  admin?: boolean;
  onStatus?: (id: string, status: Request['status'], reason?: string) => void;
  live?: boolean;
  currentUserId?: string;
  busy?: boolean;
}) {
  const [filter, setFilter] = useState('all');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const visible = requests.filter((r) => filter === 'all' || r.status === filter);
  return (
    <Card className="requests-card">
      <div className="section-heading">
        <div>
          <h2>{admin ? '요청 관리' : '나의 휴가 · 요청'}</h2>
          {!compact && <p>휴가와 외근, 기록 정정의 진행 상태를 확인해요.</p>}
        </div>
        <Button variant="ghost" className="icon-button" aria-label="새 요청 등록" onClick={onNew}>
          <Plus size={18} />
        </Button>
      </div>
      {!compact && (
        <div className="tabs" role="group" aria-label="요청 상태 필터">
          {[
            ['all', '전체'],
            ['pending', '확인 대기'],
            ['approved', '승인 완료'],
            ['cancelled', '취소'],
            ['rejected', '반려'],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={cn(filter === value && 'selected')}
              onClick={() => setFilter(value!)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className={cn('request-list', !compact && 'request-list-full')}>
        {(compact ? visible.slice(0, 3) : visible).map((r) => (
          <div className="request-item" key={r.id}>
            <span className={cn('request-icon', r.type === '기록 정정' && 'request-icon-orange')}>
              {r.type === '기록 정정' ? (
                <FilePenLine size={17} />
              ) : r.type === '외근' ? (
                <BriefcaseBusiness size={17} />
              ) : (
                <CalendarDays size={17} />
              )}
            </span>
            <div className="request-body">
              <strong>
                {r.type}
                {admin && <small> · {r.name}</small>}
              </strong>
              <span>
                {dateLabel(r.date)}
                {r.endDate !== r.date ? ` – ${dateLabel(r.endDate)}` : ''}
                {r.time ? ` · ${r.field === 'end' ? '퇴근' : '출근'} ${r.time}` : ''}
              </span>
              {!compact && r.reason && <p>{r.reason}</p>}
              {!compact && r.decisionReason && <p>처리 사유: {r.decisionReason}</p>}
            </div>
            <div className="request-status">
              <Badge tone={statusTone[r.status]}>{statusLabel[r.status]}</Badge>
              {!compact &&
                r.status === 'pending' &&
                (admin && (!live || r.userId !== currentUserId) ? (
                  <div className="request-buttons">
                    <button disabled={busy} onClick={() => onStatus?.(r.id, 'approved')}>
                      승인
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setRejectId(r.id);
                        setRejectReason('');
                      }}
                    >
                      반려
                    </button>
                  </div>
                ) : (
                  <button
                    className="cancel-request"
                    disabled={busy || (live && r.userId !== currentUserId)}
                    onClick={() => onStatus?.(r.id, 'cancelled')}
                  >
                    신청 취소
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      {!visible.length && (
        <EmptyState
          title="해당하는 요청이 없어요"
          description="새 요청을 등록하면 이곳에서 확인할 수 있어요."
          icon={<ClipboardList size={25} />}
        />
      )}
      <div className="card-footer">
        {compact ? (
          <NavLink className="ml-auto" to="/requests">
            모든 요청 보기
            <ArrowRight size={13} />
          </NavLink>
        ) : (
          <>
            <span>
              {live
                ? '정정 승인 시 원본을 보존하고 적용합니다. 휴가 잔액은 별도 관리합니다.'
                : '승인 시연은 실제 근태·휴가 잔액에 반영되지 않습니다.'}
            </span>
            <Button variant="ghost" className="text-button" onClick={onNew}>
              <Plus size={14} />새 요청
            </Button>
          </>
        )}
      </div>
      {rejectId && (
        <Modal
          title="반려 사유"
          subtitle="신청자가 확인할 수 있는 사유를 남겨 주세요."
          onClose={() => setRejectId(null)}
        >
          <form
            className="request-form"
            onSubmit={(e) => {
              e.preventDefault();
              onStatus?.(rejectId, 'rejected', rejectReason);
              setRejectId(null);
            }}
          >
            <label>
              사유
              <textarea
                required
                maxLength={200}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </label>
            <Button disabled={busy || !rejectReason.trim()} type="submit">
              반려 처리
            </Button>
          </form>
        </Modal>
      )}
    </Card>
  );
}
export function RequestForm({
  initialType,
  onClose,
  onSubmit,
  live = false,
  busy = false,
}: {
  initialType: string;
  onClose: () => void;
  onSubmit: (request: Omit<Request, 'id' | 'status' | 'name'>) => void | Promise<void>;
  live?: boolean;
  busy?: boolean;
}) {
  const [type, setType] = useState(initialType);
  const [date, setDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState('');
  const [time, setTime] = useState('');
  const [field, setField] = useState<'start' | 'end'>('start');
  const [error, setError] = useState('');
  const leave = ['연차', '오전 반차', '오후 반차'].includes(type);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = requestSchema.safeParse({
      type,
      date,
      endDate: type === '연차' ? endDate : date,
      reason,
      ...(type === '기록 정정' ? { time, field } : {}),
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? '입력을 확인해 주세요.');
      return;
    }
    try {
      await onSubmit({ ...result.data, time: type === '기록 정정' ? time : undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청을 저장하지 못했습니다.');
    }
  };
  return (
    <Modal
      title="새로운 요청"
      subtitle="휴가부터 놓친 기록까지, 간편하게 남겨보세요."
      onClose={onClose}
    >
      <form onSubmit={submit} className="request-form">
        <label>
          요청 종류
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setError('');
            }}
          >
            {['연차', '오전 반차', '오후 반차', '외근', '기록 정정'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <div className="form-date-row">
          <label>
            {type === '연차' ? '시작일' : '날짜'}
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
            />
          </label>
          {type === '연차' && (
            <label>
              종료일
              <input
                type="date"
                required
                min={date}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          )}
        </div>
        {type === '기록 정정' && (
          <>
            <label>
              정정 대상
              <select value={field} onChange={(e) => setField(e.target.value as 'start' | 'end')}>
                <option value="start">출근</option>
                <option value="end">퇴근</option>
              </select>
            </label>
            <label>
              정정할 {field === 'start' ? '출근' : '퇴근'} 시각
              <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </>
        )}
        <label>
          {leave ? '메모 (선택)' : '내용'}
          <textarea
            aria-label={leave ? '메모 (선택)' : '내용'}
            value={reason}
            required={!leave}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              leave
                ? '공유할 내용이 있을 때만 적어 주세요.'
                : type === '외근'
                  ? '방문 목적과 외근 시간대를 적어 주세요.'
                  : '정정이 필요한 이유를 적어 주세요.'
            }
            rows={3}
          />
          <span className="character-count">{reason.length} / 200</span>
        </label>
        <p className="form-note">
          {leave
            ? '확인 대기로 등록됩니다. 반차 인정시간과 휴가 잔액은 회사 기준 확정 후 연결됩니다.'
            : type === '기록 정정'
              ? '정정 요청은 원본을 덮어쓰지 않습니다. 승인 전에는 원본 기록을 변경하지 않습니다.'
              : '외근 중 이동 경로는 수집하지 않습니다. 승인 전에는 원본 기록을 변경하지 않습니다.'}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="demo-form-note">
          {live
            ? '요청은 서버에 저장되며 관리자 화면에서 확인할 수 있습니다.'
            : '실제 담당자에게 전송되지 않는 프론트엔드 시연입니다.'}
        </p>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={busy}>
            요청 등록
            <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
