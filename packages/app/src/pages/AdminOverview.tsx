import {
  BriefcaseBusiness,
  ClipboardList,
  Fingerprint,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button, Card } from '@punchin/ui';
import { teammates } from '../demo';
import type { Request } from '../types';
export function AdminOverview({
  requests,
  onRequest,
  people = teammates,
  live = false,
}: {
  requests: Request[];
  onRequest: () => void;
  people?: { name: string; state: string; status?: string }[];
  live?: boolean;
}) {
  return (
    <>
      <div className="admin-intro">
        <span className="hero-label">
          <span className="live-dot" />
          {live ? '가산 오피스 · 서버 현황' : '가산 오피스 · 시연 현황'}
        </span>
        <h2>
          작은 팀의 큰 하루,
          <br />
          빈틈없이 가볍게.
        </h2>
        <p>팀의 기록을 살피고 필요한 확인을 이어가세요.</p>
        <Button variant="secondary" onClick={onRequest}>
          <Plus size={15} />
          요청 등록
        </Button>
        <Users className="admin-illustration" size={105} strokeWidth={0.8} />
      </div>
      <div className="admin-stats">
        {[
          [
            '전체 직원',
            String(people.filter((p) => !p.status || p.status === 'active').length),
            Users,
          ],
          ['근무 중', String(people.filter((p) => p.state === '근무 중').length), Fingerprint],
          [
            '외근 · 휴가',
            String(people.filter((p) => ['외근', '연차', '휴가'].includes(p.state)).length),
            BriefcaseBusiness,
          ],
          [
            '확인 대기',
            String(requests.filter((r) => r.status === 'pending').length),
            ClipboardList,
          ],
        ].map(([label, value, Icon]) => {
          const Component = Icon as typeof Users;
          return (
            <Card key={String(label)}>
              <Component size={18} />
              <span>{String(label)}</span>
              <strong>
                {String(value)}
                <small>{label === '확인 대기' ? '건' : '명'}</small>
              </strong>
            </Card>
          );
        })}
      </div>
      <div className="admin-notice">
        <ShieldCheck size={16} />
        <p>
          {live
            ? '등록된 직원과 승인된 일정의 현황입니다. 아래 근태 기록은 로그인한 본인의 기록이며, 전사 월별 마감은 후속 단계입니다.'
            : '시연에서는 개인 근태 기록과 가상 팀 현황을 표시합니다. 실제 전사 집계는 서버 연동 후 제공됩니다.'}
        </p>
      </div>
    </>
  );
}
