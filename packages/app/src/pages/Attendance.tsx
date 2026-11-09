import { useState } from 'react';
import { ArrowDownToLine, ArrowRight, Clock3, FilePenLine } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, cn } from '@punchin/ui';
import { duration, parseTime, workedMinutes } from '@punchin/domain';
import { today, dateLabel } from '../demo';
import type { Attendance } from '../types';
export function AttendanceTable({
  records,
  compact = false,
  onDownload,
  onCorrection,
  live = false,
  referenceDate = today(),
}: {
  records: Attendance[];
  compact?: boolean;
  live?: boolean;
  referenceDate?: string;
  onDownload: (records: Attendance[]) => void;
  onCorrection?: () => void;
}) {
  const [month, setMonth] = useState(referenceDate.slice(0, 7));
  const selected = records.filter((r) => r.date.startsWith(month));
  const shown = compact ? selected.slice(0, 4) : selected;
  const total = selected.reduce(
    (sum, r) => sum + (r.start && r.end ? workedMinutes(parseTime(r.start), parseTime(r.end)) : 0),
    0,
  );
  return (
    <Card className="records-card">
      <div className="section-heading">
        <div>
          <h2>
            {compact ? '나의 최근 근무' : '나의 근태 기록'}
            <span className="heading-count">{selected.length}</span>
          </h2>
          {!compact && <p>출퇴근 원본과 실근무 시간을 확인하세요.</p>}
        </div>
        <div className="section-actions">
          {!compact && (
            <label className="month-input">
              <span className="sr-only">조회 월</span>
              <input
                aria-label="조회 월"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
          )}
          <Button variant="ghost" className="text-button" onClick={() => onDownload(shown)}>
            <ArrowDownToLine size={14} />
            <span>내보내기</span>
          </Button>
        </div>
      </div>
      {!compact && (
        <div className="record-summary">
          <div>
            <span>완료된 실근무</span>
            <strong>{duration(total)}</strong>
          </div>
          <div>
            <span>기록 일수</span>
            <strong>
              {selected.filter((r) => r.start).length}
              <small>일</small>
            </strong>
          </div>
          <div>
            <span>확인 필요</span>
            <strong>
              {selected.filter((r) => r.start && !r.end && r.date !== referenceDate).length}
              <small>건</small>
            </strong>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>출근</th>
              <th>퇴근</th>
              <th>실근무</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.date}>
                <td>
                  <span className={cn('table-date', r.date === referenceDate && 'today-date')}>
                    {dateLabel(r.date)}
                  </span>
                  {r.date === referenceDate && <span className="today-dot" />}
                </td>
                <td className="tabular">
                  {r.start || '—'}
                  {r.startCorrected && (
                    <small className="original-time">원본 {r.originalStart || '미기록'}</small>
                  )}
                </td>
                <td className="tabular">
                  {r.end || '—'}
                  {r.endCorrected && (
                    <small className="original-time">원본 {r.originalEnd || '미기록'}</small>
                  )}
                </td>
                <td className="tabular">
                  {r.start && r.end
                    ? duration(workedMinutes(parseTime(r.start), parseTime(r.end)))
                    : '—'}
                </td>
                <td>
                  <Badge
                    tone={
                      r.end ? 'neutral' : r.start && r.date === referenceDate ? 'green' : 'orange'
                    }
                  >
                    {r.needsReview ? (
                      '확인 필요'
                    ) : r.end ? (
                      '근무 완료'
                    ) : !r.start ? (
                      '미출근'
                    ) : r.date === referenceDate ? (
                      <>
                        <span className="status-dot" />
                        근무 중
                      </>
                    ) : (
                      '퇴근 누락'
                    )}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && (
        <EmptyState
          title="아직 기록이 없어요"
          description="선택한 월의 근태 기록이 여기에 표시돼요."
          icon={<Clock3 size={24} />}
        />
      )}
      <div className="card-footer">
        {compact ? (
          <>
            <span>점심 휴게시간을 제외한 기록이에요.</span>
            <NavLink to="/attendance">
              전체 기록
              <ArrowRight size={13} />
            </NavLink>
          </>
        ) : (
          <>
            <span>
              {live ? '조회 월의 서버 기록을 표시합니다.' : '조회 월의 시연 기록만 표시합니다.'}
            </span>
            <Button variant="ghost" className="text-button" onClick={onCorrection}>
              <FilePenLine size={14} />
              정정 요청
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
