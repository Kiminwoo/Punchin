import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, cn } from '@punchin/ui';
import { today, dateLabel } from '../demo';
import type { Request } from '../types';
import { statusLabel } from '../request-status';
export function CalendarPanel({ requests }: { requests: Request[] }) {
  const [view, setView] = useState(() => new Date(`${today().slice(0, 7)}-01T12:00:00+09:00`));
  const [selected, setSelected] = useState(today());
  const year = view.getUTCFullYear();
  const month = view.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const events = requests.filter(
    (r) =>
      r.status !== 'cancelled' &&
      r.status !== 'rejected' &&
      r.date <= selected &&
      r.endDate >= selected,
  );
  function move(delta: number) {
    setView(new Date(Date.UTC(year, month + delta, 1, 3)));
  }
  return (
    <Card className="calendar-card">
      <div className="section-heading">
        <h2>
          {year}년 {month + 1}월
        </h2>
        <div className="calendar-arrows">
          <button aria-label="이전 달" onClick={() => move(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button aria-label="다음 달" onClick={() => move(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <span key={d} className={cn('weekday', i === 0 && 'sunday')}>
            {d}
          </span>
        ))}
        {Array.from({ length: firstDay }, (_, i) => (
          <span key={`empty-${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
          const hasEvent = requests.some(
            (r) =>
              r.date <= date && r.endDate >= date && ['pending', 'approved'].includes(r.status),
          );
          return (
            <button
              key={date}
              aria-label={`${date}${date === today() ? ', 오늘' : ''}`}
              aria-pressed={selected === date}
              className={cn(
                'calendar-day',
                date === today() && 'is-today',
                date === selected && 'is-selected',
                (i + firstDay) % 7 === 0 && 'sunday',
              )}
              onClick={() => setSelected(date)}
            >
              {i + 1}
              {hasEvent && <i />}
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="legend-today" />
          오늘
        </span>
        <span>
          <i className="legend-event" />
          휴가 · 요청
        </span>
      </div>
      <div className="calendar-events">
        <span>{dateLabel(selected, { month: 'long', day: 'numeric' })} 일정</span>
        {events.length ? (
          events.map((r) => (
            <div key={r.id}>
              <span className="event-mark" />
              <strong>{r.type}</strong>
              <span>{statusLabel[r.status]}</span>
            </div>
          ))
        ) : (
          <p>등록된 일정이 없어요.</p>
        )}
      </div>
    </Card>
  );
}
