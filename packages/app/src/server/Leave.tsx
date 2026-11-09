import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button, Card } from '@punchin/ui';
import { Modal } from '../components/Primitives';
import { api } from './client';
import type { LiveRuntime } from './LiveApplication';
export function LeaveSummary({
  balance,
}: {
  balance: { balanceMinutes: number; pendingMinutes: number; configured: boolean };
}) {
  return (
    <Card className="leave-summary">
      <div>
        <CalendarDays size={20} />
        <strong>나의 잔여 연차</strong>
      </div>
      <p>
        {balance.configured ? (
          <>
            <strong>{balance.balanceMinutes / 480}</strong>
            <span>일</span>
          </>
        ) : (
          <span>기초 잔액 등록 전</span>
        )}
      </p>
      <small>확인 대기 {balance.pendingMinutes / 480}일 · 연차 8시간 / 반차 4시간</small>
    </Card>
  );
}
export function LeaveBalanceModal({
  runtime,
  id,
  name,
  onClose,
}: {
  runtime: LiveRuntime;
  id: string;
  name: string;
  onClose: () => void;
}) {
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<{ balanceMinutes: number; configured: boolean }>(`/admin/employees/${id}/leave`)
      .then((data) => {
        if (active) setDays(data.configured ? String(data.balanceMinutes / 480) : '');
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await runtime.mutate(`/admin/employees/${id}/leave`, { minutes: Number(days) * 480, reason });
      onClose();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '저장하지 못했습니다.');
    }
  }
  return (
    <Modal
      title={`${name}님 휴가 잔액`}
      subtitle="기존 잔여 연차를 입력하거나 근거를 남겨 조정하세요."
      onClose={onClose}
    >
      <form className="request-form" onSubmit={submit}>
        <label>
          잔여 연차 (일)
          <input
            type="number"
            required
            min={0}
            max={366}
            step={0.5}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          등록·조정 사유
          <textarea
            required
            minLength={5}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p className="form-note">
          1일은 8시간, 0.5일은 4시간입니다. 기존 잔액을 대체하는 조정 이력이 남으며 이전 차감·복원
          이력은 삭제하지 않습니다.
        </p>
        {message && (
          <p role="alert" className="form-error">
            {message}
          </p>
        )}
        <Button type="submit" disabled={runtime.busy || loading}>
          잔액 저장
        </Button>
      </form>
    </Modal>
  );
}
