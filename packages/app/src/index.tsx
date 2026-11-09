import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  FilePenLine,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { Avatar, Button, Card, cn, EmptyState } from '@punchin/ui';
import {
  duration,
  expectedEnd,
  formatTime,
  koreaMinute,
  parseTime,
  POLICY,
  workedMinutes,
} from '@punchin/domain';
import type { Audience, Attendance, DemoState } from './types';
import { today, dateLabel, seed, loadState } from './demo';
import { Logo, Modal } from './components/Primitives';
import { CalendarPanel } from './components/Calendar';
import { AttendanceTable } from './pages/Attendance';
import { RequestPanel, RequestForm } from './pages/Requests';
import { TeamPanel } from './pages/Team';
import { AdminOverview } from './pages/AdminOverview';
import { Settings } from './pages/Settings';
import { LiveApplication, type LiveRuntime } from './server/LiveApplication';
import { OfficeSettings } from './server/OfficeSettings';
import { MfaSettings } from './server/MfaSettings';
import { saveCsv } from './server/files';
import { Reports } from './server/Reports';
import { LeaveSummary } from './server/Leave';
import { Employees } from './server/Employees';
export function Application({ audience }: { audience: Audience }) {
  let demo = false;
  if (import.meta.env.DEV) {
    try {
      demo =
        new URLSearchParams(window.location.search).get('demo') === '1' ||
        sessionStorage.getItem('punchin-demo-mode') === '1';
      if (demo) sessionStorage.setItem('punchin-demo-mode', '1');
    } catch {
      demo = new URLSearchParams(window.location.search).get('demo') === '1';
    }
  }
  return (
    <BrowserRouter>
      {demo ? (
        <Workspace audience={audience} />
      ) : (
        <LiveApplication audience={audience}>
          {(runtime) => <Workspace audience={audience} live={runtime} />}
        </LiveApplication>
      )}
    </BrowserRouter>
  );
}
function Workspace({ audience, live }: { audience: Audience; live?: LiveRuntime }) {
  const [demoState, setState] = useState<DemoState>(() =>
    live ? { version: 1, day: live.snapshot.day, history: [], requests: [] } : loadState(),
  );
  const state = live?.snapshot ?? demoState;
  const user = live?.snapshot.user ?? { id: 'demo', name: '김민우', team: '프로덕트팀' };
  const workDate = live?.snapshot.day.date ?? today();
  const fail = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : '처리하지 못했습니다. 다시 확인해 주세요.');
  const [now, setNow] = useState(new Date());
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [requestType, setRequestType] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState(false);
  const [help, setHelp] = useState(false);
  const location = useLocation();
  const admin = audience === 'admin';
  useEffect(() => {
    if (live) return;
    const id = setInterval(() => {
      setNow(new Date());
      setState((previous) =>
        previous.day.date === today()
          ? previous
          : {
              ...previous,
              history: [previous.day, ...previous.history],
              day: { date: today(), start: '', end: null },
            },
      );
    }, 15000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (live) return;
    try {
      localStorage.setItem('punchin-demo-v1', JSON.stringify(state));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [state]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    setNotifications(false);
  }, [location.pathname]);
  const minute = koreaMinute(live?.now ?? now);
  const elapsed = state.day.start
    ? workedMinutes(
        parseTime(state.day.start),
        Math.max(parseTime(state.day.start), state.day.end ? parseTime(state.day.end) : minute),
      )
    : 0;
  const pending = state.requests.filter((r) => r.status === 'pending').length;
  const nav = [
    { path: '/', label: admin ? '대시보드' : '내 워크스페이스', icon: LayoutDashboard },
    { path: '/attendance', label: '근태 기록', icon: Clock3 },
    { path: '/requests', label: admin ? '요청 관리' : '휴가 · 요청', icon: CalendarDays },
    { path: '/team', label: '우리 팀', icon: Users },
    ...(admin && live ? [{ path: '/reports', label: '월별 집계', icon: FilePenLine }] : []),
  ];
  const pageTitle =
    nav.find((item) => item.path === location.pathname)?.label ?? '워크스페이스 설정';
  const saveClock = () => {
    if (live) {
      void live
        .clock('in')
        .then(() => setNotice('출근 기록을 서버에 저장했어요.'))
        .catch(fail);
      return;
    }
    const fresh = koreaMinute();
    if (fresh < POLICY.earliestStart) {
      setNotice('오전 8시 이전 기록은 담당자 확인이 필요해요. 기록 정정을 이용해 주세요.');
      return;
    }
    if (fresh > 15 * 60 + 59) {
      setNotice('오늘 8시간 근무의 종료가 다음 날이에요. 기록 정정을 이용해 주세요.');
      return;
    }
    setState((s) =>
      s.day.start ? s : { ...s, day: { date: today(), start: formatTime(fresh), end: null } },
    );
    setNotice('출근 시연 기록을 이 브라우저에 저장했어요.');
  };
  const download = async (records: Attendance[]) => {
    const rows = [
      ['날짜', '출근', '퇴근', '실근무(분)', '상태'],
      ...records.map((r) => [
        r.date,
        r.start || '',
        r.end || '',
        r.start && r.end ? workedMinutes(parseTime(r.start), parseTime(r.end)).toString() : '',
        !r.start ? '미출근' : r.end ? '퇴근' : '미완료',
      ]),
    ];
    const csv =
      '\uFEFF' +
      rows.map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    try {
      await saveCsv(csv, `punchin-${live ? 'records' : 'demo'}-${workDate}.csv`);
    } catch (error) {
      fail(error);
      return;
    }
    setNotice(
      live ? '표시된 서버 기록을 CSV로 내보냈어요.' : '화면에 표시된 시연 기록을 CSV로 내보냈어요.',
    );
  };
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-switch">
          <span className="workspace-symbol">P</span>
          <div>
            <strong>우리의 워크스페이스</strong>
            <span>{admin ? '관리자 공간' : '가산 오피스'}</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="메인 메뉴">
          {nav.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) => cn('nav-item', isActive && 'active')}
            >
              <Icon size={18} />
              <span>{label}</span>
              {path === '/requests' && pending > 0 && <span className="nav-count">{pending}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">
              <Sparkles size={17} />
            </span>
            <strong>
              기록은 간단하게,
              <br />
              하루는 더 가볍게.
            </strong>
            <p>우리 팀에 맞춘 새로운 근무 습관</p>
            <span className="note-line" />
          </div>
          <NavLink className="nav-item" to="/settings">
            <Settings2 size={18} />
            <span>워크스페이스 설정</span>
          </NavLink>
          <button className="nav-item w-full" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            <span>도움말</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <Avatar name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <span>{admin ? '워크스페이스 관리자' : user.team}</span>
            </div>
            <ShieldCheck size={16} />
          </div>
        </div>
      </aside>
      <div className="main-frame">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Logo small />
            </span>
            <span className="desktop-breadcrumb">
              워크스페이스 <ChevronRight size={13} /> <strong>{pageTitle}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            {live && (
              <NavLink to="/settings" className="notification-button" aria-label="설정">
                <Settings2 size={17} />
              </NavLink>
            )}
            {live && (
              <button
                className="notification-button"
                aria-label="로그아웃"
                disabled={live.busy}
                onClick={() => void live.logout().catch(fail)}
              >
                <LogOut size={17} />
              </button>
            )}
            <span className="demo-tag">
              <span />
              {live
                ? live.snapshot.office.enabled
                  ? '서버 연결 · GPS 사용'
                  : '서버 연결 · 위치 미검증'
                : '프론트엔드 데모'}
            </span>
            <span className="topbar-divider" />
            <div className="notification-wrap">
              <button
                className="notification-button"
                aria-label="알림"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={19} />
                <i />
              </button>
              {notifications && (
                <div className="notification-popover">
                  <strong>새로운 소식</strong>
                  <p>
                    <CheckCheck size={17} />{' '}
                    {state.requests.filter((r) => r.status === 'approved').length}건의 요청이
                    승인되었어요.
                  </p>
                  <p>
                    <FilePenLine size={17} /> 확인 대기 중인 요청 {pending}건
                  </p>
                  <span>
                    {live ? '등록된 요청의 처리 현황입니다.' : '시연 데이터 기준 알림입니다.'}
                  </span>
                </div>
              )}
            </div>
            <Avatar name={user.name} small />
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{admin ? 'TEAM OVERVIEW' : 'MY WORKSPACE'}</div>
              <h1>
                {admin
                  ? '우리 팀의 하루를 한눈에'
                  : live
                    ? `좋은 하루예요, ${user.name}님`
                    : '좋은 하루예요, 민우님'}
                <span className="greeting-sun">
                  <Sun size={27} strokeWidth={1.5} />
                </span>
              </h1>
              <p>
                {admin
                  ? '오늘의 근무 현황과 확인이 필요한 요청을 살펴보세요.'
                  : '차곡차곡 쌓이는 기록, 오늘도 나의 속도로 시작해요.'}
              </p>
            </div>
            <div className="heading-date">
              <CalendarDays size={16} />
              <span>
                {dateLabel(workDate, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                })}
              </span>
            </div>
          </div>
          {live?.refreshError && (
            <div className="storage-warning" role="alert">
              {live.refreshError}
              <Button variant="ghost" onClick={() => void live.refresh().catch(fail)}>
                다시 확인
              </Button>
            </div>
          )}
          {live && (
            <div className="connection-note">
              <ShieldCheck size={14} />
              {live.snapshot.office.enabled
                ? '서버 시각과 출퇴근 시점의 위치를 확인합니다. 외근은 사전 승인 또는 정정을 이용하세요.'
                : '서버 시각으로 기록합니다. 사무실 좌표 확인 전에는 위치를 검증하지 않습니다.'}
            </div>
          )}
          {storageError && (
            <div className="storage-warning" role="alert">
              브라우저 저장소를 사용할 수 없어 새로고침하면 시연 기록이 초기화됩니다.
            </div>
          )}
          <Routes>
            {admin && live && <Route path="/reports" element={<Reports runtime={live} />} />}
            <Route
              path="/"
              element={
                <>
                  <div className="dashboard-grid">
                    <div className="dashboard-main">
                      {admin ? (
                        <AdminOverview
                          requests={state.requests}
                          people={live?.snapshot.people}
                          live={!!live}
                          onRequest={() => setRequestType('연차')}
                        />
                      ) : (
                        <>
                          <section className="attendance-hero">
                            <div className="hero-top">
                              <span className="hero-label">
                                <span className="live-dot" />
                                {state.day.end
                                  ? '오늘의 근무 완료'
                                  : state.day.start
                                    ? '오늘도 차곡차곡, 근무 중'
                                    : '새로운 하루의 시작'}
                              </span>
                              <span className="hero-location">
                                <MapPin size={13} />
                                {live?.snapshot.office.name ?? '가산 오피스'}
                              </span>
                            </div>
                            <div className="hero-body">
                              <div>
                                <p className="hero-caption">오늘의 실근무 시간</p>
                                <div className="hero-time">
                                  {Math.floor(elapsed / 60)
                                    .toString()
                                    .padStart(2, '0')}
                                  <span>시간</span>
                                  {(elapsed % 60).toString().padStart(2, '0')}
                                  <span>분</span>
                                </div>
                                <p className="hero-description">
                                  {state.day.end
                                    ? '오늘도 수고했어요. 편안한 저녁 보내세요.'
                                    : `${duration(Math.max(0, POLICY.target - elapsed))} 더 채우면 오늘의 목표 달성!`}
                                </p>
                              </div>
                              <div className="hero-emblem" aria-hidden="true">
                                <div className="clock-face">
                                  <span className="clock-hand-hour" />
                                  <span className="clock-hand-minute" />
                                  <i />
                                </div>
                                <span className="emblem-leaf leaf-one" />
                                <span className="emblem-leaf leaf-two" />
                              </div>
                            </div>
                            <div className="hero-progress">
                              <div
                                style={{
                                  width: `${Math.min(100, (elapsed / POLICY.target) * 100)}%`,
                                }}
                              />
                            </div>
                            <div className="hero-progress-label">
                              <span>나의 하루를 채우는 중</span>
                              <span>
                                {Math.min(100, Math.floor((elapsed / POLICY.target) * 100))}%{' '}
                                <span className="muted-light">/ 8시간</span>
                              </span>
                            </div>
                            <div className="hero-bottom">
                              <div>
                                <span>출근 시각</span>
                                <strong>{state.day.start || '—'}</strong>
                              </div>
                              <div>
                                <span>{state.day.end ? '퇴근 시각' : '퇴근 예상'}</span>
                                <strong>
                                  {state.day.end ||
                                    (state.day.start
                                      ? (() => {
                                          try {
                                            return state.day.needsReview
                                              ? '확인 필요'
                                              : formatTime(expectedEnd(parseTime(state.day.start)));
                                          } catch {
                                            return '확인 필요';
                                          }
                                        })()
                                      : '—')}
                                  <span className="estimated">
                                    {!state.day.end && state.day.start ? '예정' : ''}
                                  </span>
                                </strong>
                              </div>
                              <Button
                                variant="secondary"
                                className="clock-button"
                                disabled={!!state.day.end || live?.busy}
                                onClick={() => (state.day.start ? setCheckOut(true) : saveClock())}
                              >
                                {state.day.end ? (
                                  <Check size={16} />
                                ) : state.day.start ? (
                                  <LogOut size={16} />
                                ) : (
                                  <LogIn size={16} />
                                )}{' '}
                                {state.day.end
                                  ? '근무 완료'
                                  : state.day.start
                                    ? '퇴근하기'
                                    : '출근하기'}
                              </Button>
                            </div>
                          </section>
                          <div className="quick-actions">
                            <button onClick={() => setRequestType('연차')}>
                              <span className="quick-icon quick-green">
                                <CalendarDays size={19} />
                              </span>
                              <div>
                                <strong>휴가 등록</strong>
                                <span>잠깐의 쉼이 필요할 때</span>
                              </div>
                              <ArrowUpRight size={16} />
                            </button>
                            <button onClick={() => setRequestType('외근')}>
                              <span className="quick-icon quick-peach">
                                <BriefcaseBusiness size={19} />
                              </span>
                              <div>
                                <strong>외근 등록</strong>
                                <span>사무실 밖에서도 함께</span>
                              </div>
                              <ArrowUpRight size={16} />
                            </button>
                            <button onClick={() => setRequestType('기록 정정')}>
                              <span className="quick-icon quick-lavender">
                                <FilePenLine size={19} />
                              </span>
                              <div>
                                <strong>기록 정정</strong>
                                <span>놓친 기록을 바로잡기</span>
                              </div>
                              <ArrowUpRight size={16} />
                            </button>
                          </div>
                        </>
                      )}
                      <AttendanceTable
                        records={[state.day, ...state.history]}
                        live={!!live}
                        referenceDate={workDate}
                        compact
                        onDownload={download}
                      />
                      <TeamPanel compact people={live?.snapshot.people} live={!!live} />
                    </div>
                    <div className="dashboard-side">
                      {live && <LeaveSummary balance={live.snapshot.leave} />}
                      <CalendarPanel requests={state.requests} />
                      <RequestPanel
                        live={!!live}
                        admin={admin}
                        requests={state.requests}
                        onNew={() => setRequestType('연차')}
                        compact
                      />
                      <Card className="policy-card">
                        <span className="policy-icon">
                          <Coffee size={20} />
                        </span>
                        <div>
                          <strong>점심은 여유롭게</strong>
                          <p>11:30 – 13:00 · 1시간 30분</p>
                          <span>점심시간은 실근무에서 제외돼요.</span>
                        </div>
                      </Card>
                      <div className="side-footnote">
                        <ShieldCheck size={13} />
                        <span>우리 팀의 기록을 안전하게, Punchin</span>
                      </div>
                    </div>
                  </div>
                </>
              }
            />
            <Route
              path="/attendance"
              element={
                <AttendanceTable
                  records={[state.day, ...state.history]}
                  live={!!live}
                  referenceDate={workDate}
                  onDownload={download}
                  onCorrection={() => setRequestType('기록 정정')}
                />
              }
            />
            <Route
              path="/requests"
              element={
                <RequestPanel
                  requests={state.requests}
                  onNew={() => setRequestType('연차')}
                  admin={admin}
                  live={!!live}
                  busy={live?.busy}
                  currentUserId={user.id}
                  onCancelApproved={
                    live
                      ? (id) => {
                          void live
                            .mutate(`/requests/${id}/cancellation`, {})
                            .then(() =>
                              setNotice('휴가 취소를 요청했어요. 승인 후 잔액이 복원됩니다.'),
                            )
                            .catch(fail);
                        }
                      : undefined
                  }
                  onCancellationDecision={
                    live
                      ? (id, status, reason) => {
                          void live
                            .mutate(
                              `/admin/requests/${id}/cancellation`,
                              { status, reason: reason ?? '' },
                              'PATCH',
                            )
                            .then(() => setNotice('휴가 취소 처리 결과를 저장했어요.'))
                            .catch(fail);
                        }
                      : undefined
                  }
                  onStatus={(id, status, reason, chargedMinutes) => {
                    if (live) {
                      void live
                        .mutate(
                          `/requests/${id}`,
                          {
                            status,
                            reason: reason ?? '',
                            ...(chargedMinutes !== undefined ? { chargedMinutes } : {}),
                          },
                          'PATCH',
                        )
                        .then(() => setNotice('요청 처리 결과를 서버에 저장했어요.'))
                        .catch(fail);
                      return;
                    }
                    setState((s) => ({
                      ...s,
                      requests: s.requests.map((r) => (r.id === id ? { ...r, status } : r)),
                    }));
                    setNotice(
                      status === 'approved'
                        ? '시연 요청을 승인했어요. 실제 근태에는 아직 연동되지 않아요.'
                        : '요청 상태를 변경했어요.',
                    );
                  }}
                />
              }
            />
            <Route
              path="/team"
              element={
                <>
                  <TeamPanel people={live?.snapshot.people} live={!!live} />
                  {admin && live && <Employees runtime={live} />}
                </>
              }
            />
            <Route
              path="/settings"
              element={
                <>
                  <Settings
                    live={!!live}
                    office={live?.snapshot.office}
                    onReset={() => {
                      setState(seed());
                      setNotice('시연 데이터를 처음 상태로 되돌렸어요.');
                    }}
                  />
                  {admin && live && (
                    <>
                      <MfaSettings />
                      <OfficeSettings runtime={live} />
                    </>
                  )}
                </>
              }
            />
            <Route
              path="*"
              element={
                <Card>
                  <EmptyState
                    title="페이지를 찾을 수 없어요"
                    description="메뉴에서 원하는 페이지로 이동해 주세요."
                    icon={<Search size={26} />}
                  />
                  <NavLink to="/" className="button button-primary mx-auto mb-6 w-fit">
                    워크스페이스로 돌아가기
                  </NavLink>
                </Card>
              }
            />
          </Routes>
          <footer className="page-footer">
            <span>© {new Date().getFullYear()} Punchin. A little more balance.</span>
            <span>
              {live
                ? '서버 기록 · 위치 미검증 · 가산 오피스'
                : '이 화면은 가상 직원·기록을 사용하는 시연입니다.'}
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {nav.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => cn(isActive && 'active')}
          >
            <Icon size={20} />
            <span>{label === '내 워크스페이스' ? '홈' : label}</span>
          </NavLink>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button aria-label="안내 닫기" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {requestType && (
        <RequestForm
          initialType={requestType}
          live={!!live}
          busy={live?.busy}
          onClose={() => setRequestType(null)}
          onSubmit={async (request) => {
            if (live) {
              await live.mutate('/requests', request);
              setRequestType(null);
              setNotice('요청을 서버에 등록했어요. 담당자가 확인할 수 있습니다.');
              return;
            }
            setState((s) => ({
              ...s,
              requests: [
                { ...request, id: crypto.randomUUID(), status: 'pending', name: '김민우' },
                ...s.requests,
              ],
            }));
            setRequestType(null);
            setNotice('요청을 시연 목록에 등록했어요. 실제 담당자에게 전송되지는 않아요.');
          }}
        />
      )}
      {checkOut && (
        <Modal
          title="오늘의 근무를 마칠까요?"
          subtitle="실제 퇴근 시각을 그대로 기록해요."
          onClose={() => setCheckOut(false)}
        >
          <div className="checkout-summary">
            <span>오늘 실근무</span>
            <strong>{duration(elapsed)}</strong>
            <span>퇴근 시각</span>
            <strong>{formatTime(minute)}</strong>
          </div>
          {elapsed < POLICY.target && (
            <p className="form-note">
              목표보다 {duration(POLICY.target - elapsed)} 적어요. 기록은 저장되며, 필요한 경우
              휴가나 정정을 요청할 수 있어요.
            </p>
          )}
          <p className="demo-form-note">
            {live
              ? '퇴근 확정 시 서버 시각으로 저장합니다. 위치 확인을 사용하는 경우 권한이 필요합니다.'
              : '프론트엔드 시연: 이 브라우저에만 저장됩니다.'}
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setCheckOut(false)}>
              계속 근무하기
            </Button>
            <Button
              disabled={live?.busy}
              onClick={() => {
                if (live) {
                  void live
                    .clock('out')
                    .then(() => {
                      setCheckOut(false);
                      setNotice('퇴근 기록을 서버에 저장했어요. 오늘도 수고하셨어요!');
                    })
                    .catch((error) => {
                      setCheckOut(false);
                      fail(error);
                    });
                  return;
                }
                const fresh = koreaMinute();
                if (fresh < parseTime(state.day.start)) {
                  setNotice('시각이 변경되었어요. 기록 정정을 이용해 주세요.');
                  setCheckOut(false);
                  return;
                }
                setState((s) =>
                  s.day.end ? s : { ...s, day: { ...s.day, end: formatTime(fresh) } },
                );
                setCheckOut(false);
                setNotice('퇴근 시연 기록을 저장했어요. 오늘도 수고하셨어요!');
              }}
            >
              퇴근 기록하기
              <ArrowRight size={15} />
            </Button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title="Punchin 사용 안내"
          subtitle="우리 팀의 하루를 가볍게 기록하세요."
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <p>
              <strong>출퇴근</strong> 오전 8시부터 출근하고 실근무 8시간을 채워요. 11:30~13:00 점심
              휴게와 겹치는 시간은 제외돼요.
            </p>
            <p>
              <strong>외근 · 휴가 · 정정</strong> 빠른 메뉴에서 등록하고 ‘휴가 · 요청’에서 처리
              상태를 확인해요.
            </p>
            <p>
              {live ? (
                <>
                  <strong>서버 연결 상태입니다.</strong> 출퇴근·요청·휴가 잔액·마감은 서버에
                  저장됩니다. GPS는 관리자 설정에 따라 확인하며 푸시 알림은 아직 사용하지 않습니다.
                </>
              ) : (
                <>
                  <strong>현재는 프론트엔드 시연입니다.</strong> 실제 인증·GPS·서버 저장·알림 발송은
                  연결되지 않았어요. 가상 직원 정보와 브라우저에 저장된 시연 데이터를 사용합니다.
                </>
              )}
            </p>
          </div>
          <Button className="w-full" onClick={() => setHelp(false)}>
            확인했어요
          </Button>
        </Modal>
      )}
    </div>
  );
}
