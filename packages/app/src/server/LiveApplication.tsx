import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, LoaderCircle, LogIn, RefreshCw } from 'lucide-react';
import { Button } from '@punchin/ui';
import type { Snapshot } from '@punchin/contracts';
import type { Audience } from '../types';
import { captureLocation } from './location';
import { Logo } from '../components/Primitives';
import { api, fetchWorkspace, HttpError, setSession, type SessionResponse } from './client';
export type LiveRuntime = {
  snapshot: Snapshot;
  now: Date;
  busy: boolean;
  refreshError: string;
  clock: (action: 'in' | 'out') => Promise<void>;
  mutate: (path: string, body?: unknown, method?: string) => Promise<unknown>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};
export function LiveApplication({
  audience,
  children,
}: {
  audience: Audience;
  children: (runtime: LiveRuntime) => ReactNode;
}) {
  const [session, changeSession] = useState<SessionResponse | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const measuring = useRef(false);
  const [now, setNow] = useState(new Date());
  const anchor = useRef({ time: 0, perf: 0 });
  const inFlight = useRef(false);
  const clockKeys = useRef<Partial<Record<'in' | 'out', string>>>({});
  const generation = useRef(0);
  const polling = useRef(false);
  const refreshSequence = useRef(0);
  function apply(data: Snapshot) {
    anchor.current = { time: Date.parse(data.serverNow), perf: performance.now() };
    setNow(new Date(data.serverNow));
    setSnapshot(data);
  }
  async function refresh() {
    const current = generation.current;
    const sequence = ++refreshSequence.current;
    const data = await fetchWorkspace();
    if (current === generation.current && sequence === refreshSequence.current) {
      apply(data);
      setError('');
    }
  }
  function expired() {
    generation.current++;
    setSession(null);
    changeSession(null);
    setSnapshot(null);
    setError('세션이 종료되었습니다. 다시 로그인해 주세요.');
  }
  async function initialize() {
    setLoading(true);
    setError('');
    try {
      const result = await api<SessionResponse>('/auth/me');
      setSession(result);
      changeSession(result);
      await refresh();
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        setSession(null);
        changeSession(null);
        setSnapshot(null);
      } else setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void initialize();
    return () => {
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const tick = setInterval(
      () => setNow(new Date(anchor.current.time + performance.now() - anchor.current.perf)),
      1000,
    );
    async function poll() {
      if (polling.current || inFlight.current) return;
      polling.current = true;
      try {
        await refresh();
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) expired();
        else setError('서버 갱신에 실패했습니다. 표시된 기록이 최신이 아닐 수 있어요.');
      } finally {
        polling.current = false;
      }
    }
    const interval = setInterval(() => {
      void poll();
    }, 30000);
    const visible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(tick);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [session]);
  async function mutate(path: string, body?: unknown, method = 'POST', key?: string) {
    if (inFlight.current) throw new Error('앞선 요청을 처리 중입니다. 잠시 기다려 주세요.');
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await api(path, { method, body, key });
      try {
        await refresh();
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          expired();
          throw e;
        }
        setError('서버 저장은 완료됐지만 최신 목록을 받지 못했어요. 다시 확인해 주세요.');
      }
      return result;
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) expired();
      throw e;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const runtime: LiveRuntime | null = snapshot
    ? {
        snapshot,
        now,
        busy: busy || locating,
        refreshError: error,
        refresh,
        mutate,
        clock: async (action) => {
          if (measuring.current || inFlight.current)
            throw new Error('출퇴근 요청을 처리 중입니다.');
          measuring.current = true;
          setLocating(true);
          try {
            const key = clockKeys.current[action] ?? crypto.randomUUID();
            clockKeys.current[action] = key;
            const fieldwork = snapshot.requests.some(
              (r) =>
                r.userId === snapshot.user.id &&
                r.type === '외근' &&
                r.status === 'approved' &&
                r.date <= snapshot.day.date &&
                r.endDate >= snapshot.day.date,
            );
            const location =
              snapshot.office.enabled && !fieldwork ? await captureLocation() : undefined;
            await mutate(
              '/attendance/clock',
              { action, ...(location ? { location } : {}) },
              'POST',
              key,
            );
            delete clockKeys.current[action];
          } finally {
            measuring.current = false;
            setLocating(false);
          }
        },
        logout: async () => {},
      }
    : null;
  // Logout intentionally avoids re-fetching a protected resource after revocation.
  if (runtime)
    runtime.logout = async () => {
      if (inFlight.current) return;
      setBusy(true);
      try {
        await api('/auth/logout', { method: 'POST' });
        generation.current++;
        setSession(null);
        changeSession(null);
        setSnapshot(null);
        setError('');
      } finally {
        setBusy(false);
      }
    };
  if (loading)
    return (
      <div className="auth-shell">
        <Logo />
        <p className="auth-loading">
          <LoaderCircle size={18} className="spin" />
          워크스페이스에 연결하고 있어요.
        </p>
      </div>
    );
  if (session && audience === 'admin' && session.user.role !== 'admin')
    return (
      <div className="auth-shell">
        <Logo />
        <div className="auth-card">
          <h1>관리자 권한이 필요해요</h1>
          <p>직원 계정은 직원 앱에서 사용해 주세요.</p>
          <Button
            onClick={() =>
              void api('/auth/logout', { method: 'POST' })
                .then(() => {
                  setSession(null);
                  changeSession(null);
                  setSnapshot(null);
                })
                .catch((e) => setError(e.message))
            }
          >
            다른 계정으로 로그인
          </Button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  if (runtime) return children(runtime);
  return (
    <Login
      audience={audience}
      error={error}
      onRetry={() => void initialize()}
      onLogin={async (payload, activate) => {
        const result = await api<SessionResponse>(activate ? '/auth/activate' : '/auth/login', {
          method: 'POST',
          body: payload,
        });
        setSession(result);
        changeSession(result);
        await refresh();
      }}
    />
  );
}
function Login({
  audience,
  error,
  onRetry,
  onLogin,
}: {
  audience: Audience;
  error: string;
  onRetry: () => void;
  onLogin: (payload: unknown, activate: boolean) => Promise<void>;
}) {
  const [activate, setActivate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await onLogin(
        activate ? { token: token.trim(), password } : { email: email.trim(), password },
        activate,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '로그인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <Logo />
      <div className="auth-card">
        <span className="eyebrow">
          {audience === 'admin' ? 'ADMIN WORKSPACE' : 'WELCOME TO PUNCHIN'}
        </span>
        <h1>{activate ? '우리 팀에 오신 걸 환영해요' : '우리 팀의 하루를 시작해요'}</h1>
        <p>
          {activate
            ? '관리자가 전달한 초대 코드로 계정을 활성화하세요.'
            : '회사에서 초대한 계정으로 로그인하세요.'}
        </p>
        <form className="request-form" onSubmit={submit}>
          {activate ? (
            <label>
              초대 코드
              <input
                value={token}
                required
                autoComplete="off"
                onChange={(e) => setToken(e.target.value)}
                placeholder="관리자에게 받은 초대 코드"
              />
            </label>
          ) : (
            <label>
              이메일
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          <label>
            {activate ? '새 비밀번호' : '비밀번호'}
            <input
              type="password"
              autoComplete={activate ? 'new-password' : 'current-password'}
              minLength={activate ? 12 : 1}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {activate && <p className="demo-form-note">비밀번호는 12자 이상으로 설정해 주세요.</p>}
          {(message || error) && (
            <p role="alert" className="form-error">
              {message || error}
            </p>
          )}
          <Button disabled={busy} type="submit">
            {busy ? <LoaderCircle size={15} className="spin" /> : <LogIn size={15} />}{' '}
            {activate ? '계정 활성화' : '로그인'}
            <ArrowRight size={14} />
          </Button>
        </form>
        <button
          className="auth-text-button"
          onClick={() => {
            setActivate(!activate);
            setMessage('');
            setPassword('');
          }}
        >
          {activate ? '로그인으로 돌아가기' : '초대 코드로 처음 시작하기'}
        </button>
        {error && (
          <Button variant="ghost" onClick={onRetry}>
            <RefreshCw size={14} />
            연결 다시 확인
          </Button>
        )}
        <div className="auth-footnote">
          가산 오피스 · 회사 전용 워크스페이스
          <br />
          위치 인증은 아직 설정되지 않았습니다.
        </div>
        {import.meta.env.DEV && (
          <button
            className="auth-text-button demo-entry"
            onClick={() => {
              try {
                sessionStorage.setItem('punchin-demo-mode', '1');
              } catch {}
              window.location.assign('/?demo=1');
            }}
          >
            가상 데이터로 화면 시연 보기
          </button>
        )}
      </div>
      <span className="auth-copyright">A little more balance. Punchin.</span>
    </div>
  );
}
