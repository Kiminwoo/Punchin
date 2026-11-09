import { useState } from 'react';
import { ArrowRight, MapPin, Search } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Avatar, Badge, Card, EmptyState, cn } from '@punchin/ui';
import { teammates } from '../demo';
type TeamMember = {
  id?: string;
  name: string;
  team: string;
  role: string;
  roleLabel?: string;
  state: string;
  start: string;
  color: string;
  status?: string;
};
export function TeamPanel({
  compact = false,
  people = teammates,
  live = false,
}: {
  compact?: boolean;
  people?: TeamMember[];
  live?: boolean;
}) {
  const members = people.filter((p) => !p.status || p.status === 'active');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('전체');
  const visible = members.filter(
    (m) => (filter === '전체' || m.state === filter) && `${m.name} ${m.team}`.includes(query),
  );
  return (
    <Card className="team-card">
      <div className="section-heading">
        <div>
          <h2>
            함께하는 우리 팀<span className="heading-count">{members.length}</span>
          </h2>
          {!compact && (
            <p>
              {live
                ? '승인된 일정과 출퇴근 기록을 기준으로 표시합니다.'
                : '가상 직원으로 구성한 팀 현황 시연입니다.'}
            </p>
          )}
        </div>
        {compact ? (
          <NavLink className="section-link" to="/team">
            전체 보기
            <ArrowRight size={13} />
          </NavLink>
        ) : (
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="직원 검색"
              placeholder="이름, 팀 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
      </div>
      {compact ? (
        <div className="team-preview">
          <div className="avatar-stack">
            {members.slice(0, 5).map((t) => (
              <Avatar key={t.id ?? t.name} name={t.name} color={t.color} />
            ))}
          </div>
          <div>
            <strong>각자의 자리에서, 함께</strong>
            <p>
              <span className="status-dot" />
              {members.filter((t) => t.state === '근무 중').length}명 근무 중{' '}
              <span className="team-separator">·</span>{' '}
              {members.filter((t) => t.state === '외근').length}명 외근{' '}
              <span className="team-separator">·</span>{' '}
              {members.filter((t) => ['연차', '휴가'].includes(t.state)).length}명 휴가
            </p>
          </div>
          <span className="team-office">
            <MapPin size={13} />
            가산 오피스
          </span>
        </div>
      ) : (
        <>
          <div className="tabs" role="group" aria-label="팀 근무 상태">
            {[
              '전체',
              '근무 중',
              '외근',
              live ? '휴가' : '연차',
              ...(live ? ['미출근', '퇴근'] : []),
            ].map((value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={cn(filter === value && 'selected')}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="team-grid">
            {visible.map((t) => (
              <div className="team-member" key={t.id ?? t.name}>
                <Avatar name={t.name} color={t.color} />
                <div>
                  <strong>{t.name}</strong>
                  <p>{t.roleLabel ?? t.role}</p>
                  <span>{t.team}</span>
                </div>
                <Badge
                  tone={t.state === '근무 중' ? 'green' : t.state === '외근' ? 'orange' : 'blue'}
                >
                  {t.state}
                </Badge>
                <div className="member-foot">
                  <span>
                    <MapPin size={12} />{' '}
                    {t.state === '외근'
                      ? '사무실 외'
                      : ['연차', '휴가'].includes(t.state)
                        ? '휴가 중'
                        : '가산 오피스'}
                  </span>
                  <span>
                    {!t.start || t.start === '—'
                      ? ['휴가', '연차'].includes(t.state)
                        ? '오늘은 쉬어가요'
                        : '출근 시각 비공개·미기록'
                      : `${t.start} 출근`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {!visible.length && (
            <EmptyState
              title="검색 결과가 없어요"
              description="다른 이름이나 팀 이름으로 검색해 주세요."
              icon={<Search size={24} />}
            />
          )}
        </>
      )}
    </Card>
  );
}
