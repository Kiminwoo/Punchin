import { useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, UserRoundX } from 'lucide-react';
import type { Person } from '@punchin/contracts';
import { Badge, Button, Card } from '@punchin/ui';
import { Modal } from '../components/Primitives';
import type { LiveRuntime } from './LiveApplication';
export function Employees({ runtime }: { runtime: LiveRuntime }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('employee');
  const [result, setResult] = useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Person | null>(null);
  async function invite(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const response = (await runtime.mutate('/admin/invitations', {
        name,
        email,
        team,
        role,
      })) as { token: string; expiresAt: string };
      setResult(response);
      setName('');
      setEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '초대하지 못했습니다.');
    }
  }
  return (
    <Card className="employee-management">
      <div className="section-heading">
        <div>
          <h2>직원 계정 관리</h2>
          <p>초대 코드를 직접 전달하고, 퇴사 시 접근을 차단하세요.</p>
        </div>
        <Button
          disabled={runtime.busy}
          onClick={() => {
            setShow(true);
            setResult(null);
            setError('');
          }}
        >
          <Plus size={14} />
          직원 초대
        </Button>
      </div>
      <div className="employee-list">
        {error && !show && !target && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {runtime.snapshot.people.map((person) => (
          <div className="employee-row" key={person.id}>
            <div>
              <strong>{person.name}</strong>
              <span>
                {person.email} · {person.roleLabel}
              </span>
            </div>
            <Badge tone={person.status === 'active' ? 'green' : 'neutral'}>
              {person.status === 'active'
                ? '활성'
                : person.status === 'invited'
                  ? '초대 중'
                  : '비활성'}
            </Badge>
            {person.status === 'invited' && (
              <Button
                variant="ghost"
                disabled={runtime.busy}
                onClick={() => {
                  setError('');
                  void runtime
                    .mutate(`/admin/employees/${person.id}/invitation`)
                    .then((response) => {
                      setResult(response as { token: string; expiresAt: string });
                      setShow(true);
                    })
                    .catch((e) => setError(e.message));
                }}
              >
                재발급
              </Button>
            )}
            {person.status !== 'inactive' && person.id !== runtime.snapshot.user.id && (
              <Button
                variant="ghost"
                className="icon-button"
                aria-label={`${person.name} 계정 비활성화`}
                disabled={runtime.busy}
                onClick={() => {
                  setTarget(person);
                  setError('');
                }}
              >
                <UserRoundX size={15} />
              </Button>
            )}
          </div>
        ))}
      </div>
      {show && (
        <Modal
          title={result ? '초대 코드가 준비됐어요' : '직원 초대'}
          subtitle="실제 이메일은 발송하지 않습니다. 코드를 안전하게 직접 전달해 주세요."
          onClose={() => setShow(false)}
        >
          {result ? (
            <div className="request-form">
              <label>
                일회용 초대 코드
                <input readOnly value={result.token} onFocus={(e) => e.target.select()} />
              </label>
              <p className="form-note">
                72시간 후 만료됩니다. 이 창을 닫기 전에 코드를 복사하세요. 전달받은 직원은 로그인
                화면에서 ‘초대 코드로 처음 시작하기’를 선택합니다.
              </p>
              <Button onClick={() => setShow(false)}>확인</Button>
            </div>
          ) : (
            <form className="request-form" onSubmit={invite}>
              <label>
                이름
                <input
                  required
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                이메일
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                팀
                <input
                  required
                  maxLength={50}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                />
              </label>
              <label>
                권한
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="employee">직원</option>
                  <option value="admin">관리자</option>
                </select>
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={runtime.busy}>
                초대 코드 생성
              </Button>
            </form>
          )}
        </Modal>
      )}
      {target && (
        <Modal
          title={`${target.name}님의 접근을 차단할까요?`}
          subtitle="현재 로그인과 미사용 초대 코드가 모두 무효화됩니다. 근태 원본은 보존됩니다."
          onClose={() => setTarget(null)}
        >
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setTarget(null)}>
              취소
            </Button>
            <Button
              variant="danger"
              disabled={runtime.busy}
              onClick={() => {
                void runtime
                  .mutate(`/admin/employees/${target.id}/deactivate`)
                  .then(() => setTarget(null))
                  .catch((e) => setError(e.message));
              }}
            >
              계정 비활성화
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
