import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Button, Card } from '@punchin/ui';
import { api } from './client';
export function MfaSettings() {
  const [status, setStatus] = useState<{
    configured: boolean;
    enabled: boolean;
    required: boolean;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setStatus(await api('/auth/mfa'));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (status?.enabled) {
        await api('/auth/mfa/disable', { method: 'POST', body: { password, code } });
        setCode('');
        setPassword('');
        await load();
        return;
      }
      if (!enrollment) {
        const result = await api<{ secret: string; uri: string }>('/auth/mfa/enroll', {
          method: 'POST',
          body: { password },
        });
        setPassword('');
        setEnrollment(result);
        return;
      }
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
        method: 'POST',
        body: { code },
      });
      setRecovery(result.recoveryCodes);
      setEnrollment(null);
      setCode('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="office-settings">
      <div className="section-heading">
        <div>
          <h2>관리자 2단계 인증</h2>
          <p>인증앱 코드로 로그인하고 일회용 복구 코드를 안전하게 보관하세요.</p>
        </div>
        <Badge tone={status?.enabled ? 'green' : 'orange'}>
          {status?.enabled ? '사용 중' : '등록 전'}
        </Badge>
      </div>
      <div className="settings-description">
        {!status?.configured && (
          <p>서버의 인증 보관 키를 설정해야 등록할 수 있습니다. 운영 담당자에게 문의해 주세요.</p>
        )}
        {status?.required && !status.enabled && (
          <p>직원 초대 등 관리자 업무를 시작하기 전에 2단계 인증 등록이 필요합니다.</p>
        )}
        {recovery.length > 0 ? (
          <div className="request-form">
            <label>
              일회용 복구 코드
              <textarea
                readOnly
                rows={8}
                value={recovery.join('\n')}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <p className="form-note">
              이 코드는 다시 표시되지 않습니다. 회사가 관리하는 비밀번호 관리 도구 등에 보관하세요.
              코드 하나는 한 번만 사용할 수 있습니다.
            </p>
            <Button onClick={() => setRecovery([])}>복구 코드를 보관했습니다</Button>
          </div>
        ) : (
          <form className="request-form" onSubmit={submit}>
            {!enrollment && (
              <label>
                현재 비밀번호
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {enrollment && (
              <>
                <label>
                  인증앱 수동 등록 키
                  <input readOnly value={enrollment.secret} onFocus={(e) => e.target.select()} />
                </label>
                <p className="form-note">
                  인증앱에서 시간 기반(TOTP), 6자리 코드를 선택하고 위 키를 등록하세요. 10분 안에
                  생성된 코드를 아래에 입력합니다. 등록 키를 다른 사람에게 전달하지 마세요.
                </p>
              </>
            )}
            {(status?.enabled || enrollment) && (
              <label>
                {status?.enabled ? '인증앱 또는 복구 코드' : '인증앱 6자리 코드'}
                <input
                  required
                  autoComplete="one-time-code"
                  maxLength={32}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || !status?.configured}>
              {status?.enabled
                ? '인증앱 변경을 위해 해제'
                : enrollment
                  ? '인증 확인·등록 완료'
                  : '2단계 인증 등록 시작'}
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
