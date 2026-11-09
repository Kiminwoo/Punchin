import { Mfa, mfaKey } from './mfa';
import {
  leaveDetail,
  adjustLeave,
  requestLeaveCancellation,
  decideLeaveCancellation,
} from './leave';
import {
  monthlyReport,
  closeMonth,
  reopenMonth,
  exportReport,
  issueReset,
  resetPassword,
} from './operations';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { loginSchema, activateSchema, clockSchema, decisionSchema } from '@punchin/contracts';
import type { SessionUser } from '@punchin/contracts';
import { Service, type UserRow } from './service';
import { ApiError, digest, equal, hashPassword, token, verifyPassword } from './security';

type Auth = { user: UserRow; tokenHash: string; csrf: string; transport: 'web' | 'native' };
declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
}
export async function createServer(options: {
  db: DatabaseSync;
  now?: () => Date;
  origins?: string[];
  secureCookies?: boolean;
  logger?: boolean;
  mfaKey?: string;
  requireAdminMfa?: boolean;
}) {
  const store = new Service(options.db, options.now);
  const mfa = new Mfa(store, mfaKey(options.mfaKey), !!options.requireAdminMfa);
  const origins = options.origins ?? [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ];
  const app = Fastify({
    bodyLimit: 16384,
    logger: options.logger
      ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'] }
      : false,
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !!origin && origins.includes(origin)),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'X-CSRF-Token',
      'Idempotency-Key',
      'Authorization',
      'X-Punchin-Client',
    ],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', hook: 'preHandler' });
  app.decorateRequest('auth', null);
  const dummyHash = await hashPassword(token());
  const cookieOptions = {
    httpOnly: true,
    secure: !!options.secureCookies,
    sameSite: 'lax' as const,
    path: '/api',
    maxAge: 8 * 3600,
  };
  const publicPaths = new Set([
    '/api/auth/login',
    '/api/auth/activate',
    '/api/health',
    '/api/auth/reset',
    '/api/mobile/auth/reset',
    '/api/mobile/auth/login',
    '/api/mobile/auth/activate',
  ]);
  const nativeOrigins = ['capacitor://localhost', 'https://localhost', 'http://localhost'];
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS' || request.url === '/api/health') return;
    const path = request.url.split('?')[0]!;
    const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const transport = request.headers.authorization ? 'native' : 'web';
    const sessionToken = request.headers.authorization ? bearer : request.cookies.punchin_session;
    if (sessionToken) {
      const session = store.one<{ user_id: string; csrf: string }>(
        'SELECT user_id,csrf FROM sessions WHERE token_hash=? AND expires_at>? AND transport=?',
        digest(sessionToken),
        store.now().toISOString(),
        transport,
      );
      const user = session
        ? store.one<UserRow>("SELECT * FROM users WHERE id=? AND status='active'", session.user_id)
        : undefined;
      if (session && user)
        request.auth = { user, csrf: session.csrf, tokenHash: digest(sessionToken), transport };
    }
    const nativeLogin =
      path.startsWith('/api/mobile/auth/') &&
      publicPaths.has(path) &&
      request.headers['x-punchin-client'] === 'native';
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (request.auth?.transport === 'native' || nativeLogin) {
        if (
          request.headers.origin &&
          !origins.includes(request.headers.origin) &&
          !nativeOrigins.includes(request.headers.origin)
        )
          throw new ApiError(403, '허용된 앱에서 요청해 주세요.');
      } else if (!request.headers.origin || !origins.includes(request.headers.origin))
        throw new ApiError(403, '허용된 앱에서 요청해 주세요.');
    }
    if (path.startsWith('/api/mobile/auth/') && !nativeLogin)
      throw new ApiError(403, '모바일 인증 요청을 확인해 주세요.');
    if (publicPaths.has(request.url.split('?')[0]!)) return;
    if (!request.auth) throw new ApiError(401, '로그인이 필요합니다.');
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      request.auth.transport === 'web' &&
      !equal(String(request.headers['x-csrf-token'] ?? ''), request.auth.csrf)
    )
      throw new ApiError(403, '세션을 새로고침한 후 다시 요청해 주세요.');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply
        .status(400)
        .send({ message: error.issues[0]?.message ?? '입력값을 확인해 주세요.' });
    const failure = error as { statusCode?: number; message?: string };
    const status =
      error instanceof ApiError
        ? error.statusCode
        : typeof failure?.statusCode === 'number' && failure.statusCode < 500
          ? failure.statusCode
          : 500;
    if (status === 500) app.log.error({ err: error }, 'API operation failed');
    return reply.status(status).send({
      message:
        status === 500
          ? '서버 처리 중 문제가 발생했습니다.'
          : (failure.message ?? '요청을 처리하지 못했습니다.'),
    });
  });
  function admin(user: SessionUser) {
    if (user.role !== 'admin') throw new ApiError(403, '관리자 권한이 필요합니다.');
    if (options.requireAdminMfa && !mfa.status(user as UserRow).enabled)
      throw new ApiError(403, '설정에서 관리자 2단계 인증을 먼저 등록해 주세요.');
  }
  function sessionFor(user: UserRow, previousToken?: string, transport: 'web' | 'native' = 'web') {
    const secret = token();
    const csrf = token();
    if (previousToken)
      store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(previousToken));
    store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(store.now().toISOString());
    store.db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,csrf,expires_at,transport) VALUES(?,?,?,?,?)',
      )
      .run(
        digest(secret),
        user.id,
        csrf,
        new Date(store.now().getTime() + 8 * 3600000).toISOString(),
        transport,
      );
    const safe: SessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      team: user.team,
      role: user.role,
    };
    return {
      secret,
      payload: {
        user: safe,
        csrfToken: transport === 'web' ? csrf : '',
        ...(transport === 'native' ? { sessionToken: secret } : {}),
      },
    };
  }
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
          keyGenerator: (req) =>
            `${req.ip}:${String((req.body as { email?: unknown })?.email ?? '')
              .trim()
              .toLowerCase()
              .slice(0, 254)}`,
        },
      },
    },
    async (req, reply) => {
      const data = loginSchema.parse(req.body);
      const user = store.one<UserRow>('SELECT * FROM users WHERE email=?', data.email);
      const valid = await verifyPassword(data.password, user?.password_hash ?? dummyHash);
      if (!valid || !user || user.status !== 'active' || user.reset_required)
        throw new ApiError(401, '이메일 또는 비밀번호를 확인해 주세요.');
      // Recheck after async password hashing so a concurrent deactivation cannot reopen access.
      if (
        ((current) =>
          !current ||
          current.status !== 'active' ||
          !!current.reset_required ||
          current.password_hash !== user.password_hash)(
          store.one<UserRow>('SELECT * FROM users WHERE id=?', user.id),
        )
      )
        throw new ApiError(401, '이메일 또는 비밀번호를 확인해 주세요.');
      mfa.verify(user, data.code);
      const session = sessionFor(user, req.cookies.punchin_session);
      store.audit(user.id, 'logged_in', user.id);
      reply.setCookie('punchin_session', session.secret, cookieOptions);
      return session.payload;
    },
  );
  app.post(
    '/api/auth/activate',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const data = activateSchema.parse(req.body);
      const user = await store.activate(data.token, data.password);
      const session = sessionFor(user, req.cookies.punchin_session);
      reply.setCookie('punchin_session', session.secret, cookieOptions);
      return session.payload;
    },
  );
  app.post(
    '/api/mobile/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
          keyGenerator: (req) =>
            `${req.ip}:${String((req.body as { email?: unknown })?.email ?? '')
              .toLowerCase()
              .slice(0, 254)}`,
        },
      },
    },
    async (req) => {
      const data = loginSchema.parse(req.body);
      const user = store.one<UserRow>('SELECT * FROM users WHERE email=?', data.email);
      const valid = await verifyPassword(data.password, user?.password_hash ?? dummyHash);
      if (
        !valid ||
        !user ||
        user.status !== 'active' ||
        !!user.reset_required ||
        ((current) =>
          !current ||
          current.status !== 'active' ||
          !!current.reset_required ||
          current.password_hash !== user.password_hash)(
          store.one<UserRow>('SELECT * FROM users WHERE id=?', user.id),
        )
      )
        throw new ApiError(401, '이메일 또는 비밀번호를 확인해 주세요.');
      mfa.verify(user, data.code);
      const session = sessionFor(user, undefined, 'native');
      store.audit(user.id, 'native_logged_in', user.id);
      return session.payload;
    },
  );
  app.post(
    '/api/mobile/auth/activate',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (req) => {
      const data = activateSchema.parse(req.body);
      const user = await store.activate(data.token, data.password);
      return sessionFor(user, undefined, 'native').payload;
    },
  );
  for (const mobile of [false, true])
    app.post(
      mobile ? '/api/mobile/auth/reset' : '/api/auth/reset',
      { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
      async (req, reply) => {
        const data = activateSchema.parse(req.body);
        const user = await resetPassword(store, data.token, data.password, (user) =>
          mfa.verify(user, data.code),
        );
        const session = sessionFor(user, undefined, mobile ? 'native' : 'web');
        if (!mobile) reply.setCookie('punchin_session', session.secret, cookieOptions);
        return session.payload;
      },
    );
  app.get<{ Querystring: { month: string } }>('/api/admin/reports', async (req) => {
    admin(req.auth!.user);
    return monthlyReport(store, req.query.month);
  });
  app.post<{ Params: { month: string } }>('/api/admin/months/:month/close', async (req) => {
    admin(req.auth!.user);
    return closeMonth(store, req.auth!.user, req.params.month);
  });
  app.post<{ Params: { month: string } }>('/api/admin/months/:month/reopen', async (req) => {
    admin(req.auth!.user);
    const data = z
      .object({ reason: z.string().trim().min(5).max(200) })
      .strict()
      .parse(req.body);
    reopenMonth(store, req.auth!.user, req.params.month, data.reason);
    return { ok: true };
  });
  app.post<{ Params: { month: string } }>('/api/admin/reports/:month/export', async (req) => {
    admin(req.auth!.user);
    return exportReport(store, req.auth!.user, req.params.month);
  });
  app.post<{ Params: { id: string } }>('/api/admin/employees/:id/reset-password', async (req) => {
    admin(req.auth!.user);
    return issueReset(store, req.auth!.user, req.params.id);
  });
  app.get('/api/auth/mfa', async (req) => mfa.status(req.auth!.user));
  app.post(
    '/api/auth/mfa/enroll',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req) => {
      if (req.auth!.user.role !== 'admin') throw new ApiError(403, '관리자만 등록할 수 있습니다.');
      const data = z
        .object({ password: z.string().min(1).max(128) })
        .strict()
        .parse(req.body);
      const current = req.auth!.user;
      if (!current.password_hash || !(await verifyPassword(data.password, current.password_hash)))
        throw new ApiError(401, '비밀번호를 확인해 주세요.');
      if (
        store.one<UserRow>('SELECT * FROM users WHERE id=?', current.id)?.password_hash !==
        current.password_hash
      )
        throw new ApiError(401, '계정을 다시 확인해 주세요.');
      return mfa.enroll(current);
    },
  );
  app.post(
    '/api/auth/mfa/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req) => {
      if (req.auth!.user.role !== 'admin') throw new ApiError(403, '관리자만 등록할 수 있습니다.');
      const data = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(req.body);
      return mfa.confirm(req.auth!.user, data.code, req.auth!.tokenHash);
    },
  );
  app.post(
    '/api/auth/mfa/disable',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req) => {
      const data = z
        .object({ password: z.string().min(1).max(128), code: z.string().min(6).max(32) })
        .strict()
        .parse(req.body);
      if (
        !req.auth!.user.password_hash ||
        !(await verifyPassword(data.password, req.auth!.user.password_hash))
      )
        throw new ApiError(401, '비밀번호를 확인해 주세요.');
      return mfa.disable(req.auth!.user, data.code, req.auth!.tokenHash);
    },
  );
  app.get('/api/auth/me', async (req) => ({
    user: {
      id: req.auth!.user.id,
      name: req.auth!.user.name,
      email: req.auth!.user.email,
      team: req.auth!.user.team,
      role: req.auth!.user.role,
    },
    csrfToken: req.auth!.csrf,
  }));
  app.post('/api/auth/logout', async (req, reply) => {
    store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.auth!.tokenHash);
    if (req.auth!.transport === 'web') reply.clearCookie('punchin_session', { path: '/api' });
    return { ok: true };
  });
  app.get('/api/workspace', async (req) => store.snapshot(req.auth!.user));
  app.post('/api/attendance/clock', async (req) => {
    const data = clockSchema.parse(req.body);
    const key = z.uuid().parse(req.headers['idempotency-key']);
    return store.clock(req.auth!.user, data.action, key, data.location);
  });
  app.post('/api/requests', async (req) => store.createRequest(req.auth!.user, req.body));
  app.patch<{ Params: { id: string } }>('/api/requests/:id', async (req) => {
    const data = decisionSchema.parse(req.body);
    if (data.status !== 'cancelled') admin(req.auth!.user);
    store.decide(req.auth!.user, req.params.id, data.status, data.reason, data.chargedMinutes);
    return { ok: true };
  });
  app.post('/api/admin/invitations', async (req) => {
    admin(req.auth!.user);
    return store.invite(req.auth!.user, req.body);
  });
  app.post<{ Params: { id: string } }>('/api/admin/employees/:id/invitation', async (req) => {
    admin(req.auth!.user);
    return store.reinvite(req.auth!.user, req.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/admin/employees/:id/deactivate', async (req) => {
    admin(req.auth!.user);
    store.deactivate(req.auth!.user, req.params.id);
    return { ok: true };
  });
  app.patch('/api/admin/office', async (req) => {
    admin(req.auth!.user);
    return store.updateOffice(req.auth!.user, req.body);
  });
  app.get('/api/leave', async (req) => leaveDetail(store, req.auth!.user.id));
  app.get<{ Params: { id: string } }>('/api/admin/employees/:id/leave', async (req) => {
    admin(req.auth!.user);
    return leaveDetail(store, req.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/admin/employees/:id/leave', async (req) => {
    admin(req.auth!.user);
    return adjustLeave(store, req.auth!.user, req.params.id, req.body);
  });
  app.post<{ Params: { id: string } }>('/api/requests/:id/cancellation', async (req) =>
    requestLeaveCancellation(store, req.auth!.user, req.params.id),
  );
  app.patch<{ Params: { id: string } }>('/api/admin/requests/:id/cancellation', async (req) => {
    admin(req.auth!.user);
    const data = z
      .object({
        status: z.enum(['approved', 'rejected']),
        reason: z.string().trim().max(200).default(''),
      })
      .strict()
      .parse(req.body);
    return decideLeaveCancellation(store, req.auth!.user, req.params.id, data.status, data.reason);
  });
  app.get('/api/admin/audit', async (req) => {
    admin(req.auth!.user);
    return {
      entries: store.all(
        'SELECT id,actor_id,action,subject_id,detail,recorded_at FROM audit ORDER BY recorded_at DESC,id DESC LIMIT 200',
      ),
    };
  });
  await app.ready();
  return { app, store };
}
