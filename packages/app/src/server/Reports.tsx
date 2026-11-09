import { useEffect, useState } from 'react';
import { ArrowDownToLine, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@punchin/ui';
import { duration, koreaDate } from '@punchin/domain';
import type { MonthlyReport } from '@punchin/contracts';
import { Modal } from '../components/Primitives';
import { api } from './client';
import type { LiveRuntime } from './LiveApplication';
export function Reports({ runtime }: { runtime: LiveRuntime }) {
  const [month, setMonth] = useState(runtime.snapshot.day.date.slice(0, 7));
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null);
  const [reason, setReason] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setReport(null);
    setLoading(true);
    setError('');
    api<MonthlyReport>(`/admin/reports?month=${month}`)
      .then((data) => {
        if (active) setReport(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, revision]);
  async function mutate() {
    if (!confirm) return;
    setBusy(true);
    try {
      await runtime.mutate(
        `/admin/months/${month}/${confirm}`,
        confirm === 'reopen' ? { reason } : {},
      );
      setConfirm(null);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다.');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    try {
      const data = (await runtime.mutate(`/admin/reports/${month}/export`, {})) as {
        filename: string;
        csv: string;
      };
      const url = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '내보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <div className="section-heading">
        <div>
          <h2>전사 월별 근태 · 마감</h2>
          <p>기록된 실근무를 집계합니다. 예정 근무일·급여 금액은 포함하지 않습니다.</p>
        </div>
        <input
          type="month"
          aria-label="집계 월"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="report-month"
        />
      </div>
      {error && (
        <p className="form-error report-message" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <EmptyState title="기록을 불러오고 있어요" description="서버의 확정 기록을 조회합니다." />
      ) : (
        report && (
          <>
            <div className="report-toolbar">
              <Badge tone={report.state === 'closed' ? 'green' : 'orange'}>
                {report.state === 'closed' ? `마감 완료 · v${report.version}` : '마감 전'}
              </Badge>
              <span>
                실근무 {duration(report.summary.minutes)} · 기록 {report.summary.records}건 · 확인
                필요 {report.summary.incomplete}건 · 대기 {report.summary.pending}건
              </span>
              <Button
                variant="secondary"
                disabled={busy || runtime.busy}
                onClick={() => void download()}
              >
                <ArrowDownToLine size={14} />
                CSV 내보내기
              </Button>
              <Button
                disabled={
                  busy ||
                  runtime.busy ||
                  (report.state === 'open' && month >= koreaDate(runtime.now).slice(0, 7))
                }
                onClick={() => {
                  setConfirm(report.state === 'closed' ? 'reopen' : 'close');
                  setReason('');
                }}
              >
                {report.state === 'closed' ? (
                  <LockKeyholeOpen size={14} />
                ) : (
                  <LockKeyhole size={14} />
                )}{' '}
                {report.state === 'closed' ? '재개방' : '월 마감'}
              </Button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {['직원', '날짜', '출근', '퇴근', '실근무', '기록 상태'].map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={`${row.userId}-${row.date}`}>
                      <td>
                        {row.name}
                        <small className="original-time">{row.team}</small>
                      </td>
                      <td>{row.date}</td>
                      <td>
                        {row.start}
                        {row.corrected && (
                          <small className="original-time">
                            원본 {row.originalStart || '미기록'}
                          </small>
                        )}
                      </td>
                      <td>
                        {row.end || '—'}
                        {row.corrected && (
                          <small className="original-time">
                            원본 {row.originalEnd || '미기록'}
                          </small>
                        )}
                      </td>
                      <td>{row.minutes === null ? '—' : duration(row.minutes)}</td>
                      <td>
                        <Badge
                          tone={row.minutes === null || row.needsReview ? 'orange' : 'neutral'}
                        >
                          {row.minutes === null
                            ? '누락'
                            : row.needsReview
                              ? '확인 필요'
                              : row.corrected
                                ? '정정 반영'
                                : '기록 완료'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.rows.length && (
              <EmptyState
                title="조회 월의 기록이 없어요"
                description="기록이 있는 월을 선택해 주세요."
              />
            )}
            <div className="card-footer">
              마감된 월은 정정·휴가 변경을 막고 집계본을 보존합니다. 현재 월은 종료 후 마감할 수
              있어요.
            </div>
          </>
        )
      )}
      {confirm && (
        <Modal
          title={
            confirm === 'close' ? `${month} 근태를 마감할까요?` : `${month} 근태를 재개방할까요?`
          }
          subtitle={
            confirm === 'close'
              ? '대기·누락이 없어야 하며 마감된 집계본은 버전으로 보존됩니다.'
              : '변경 사유를 남기고 다시 마감할 수 있습니다. 이전 집계본은 유지됩니다.'
          }
          onClose={() => setConfirm(null)}
        >
          <form
            className="request-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate();
            }}
          >
            {confirm === 'reopen' && (
              <label>
                재개방 사유
                <textarea
                  required
                  minLength={5}
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
            <Button type="submit" disabled={busy || runtime.busy}>
              확인 · {confirm === 'close' ? '마감' : '재개방'}
            </Button>
          </form>
        </Modal>
      )}
    </Card>
  );
}
