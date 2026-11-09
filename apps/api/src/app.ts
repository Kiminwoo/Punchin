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

type Auth = { user: UserRow; tokenHash: string; csrf: string };
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
}) {
  const store = new Service(options.db, options.now);
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
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
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
  const publicPaths = new Set(['/api/auth/login', '/api/auth/activate', '/api/health']);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS' || request.url === '/api/health') return;
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      (!request.headers.origin || !origins.includes(request.headers.origin))
    )
      throw new ApiError(403, '허용된 앱에서 요청해 주세요.');
    const sessionToken = request.cookies.punchin_session;
    if (sessionToken) {
      const session = store.one<{ user_id: string; csrf: string }>(
        'SELECT user_id,csrf FROM sessions WHERE token_hash=? AND expires_at>?',
        digest(sessionToken),
        store.now().toISOString(),
      );
      const user = session
        ? store.one<UserRow>("SELECT * FROM users WHERE id=? AND status='active'", session.user_id)
        : undefined;
      if (session && user)
        request.auth = { user, csrf: session.csrf, tokenHash: digest(sessionToken) };
    }
    if (publicPaths.has(request.url.split('?')[0]!)) return;
    if (!request.auth) throw new ApiError(401, '로그인이 필요합니다.');
    if (
      !['GET', 'HEAD'].includes(request.method) &&
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
  }
  function sessionFor(user: UserRow, previousToken?: string) {
    const secret = token();
    const csrf = token();
    if (previousToken)
      store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(previousToken));
    store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(store.now().toISOString());
    store.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .run(
        digest(secret),
        user.id,
        csrf,
        new Date(store.now().getTime() + 8 * 3600000).toISOString(),
      );
    const safe: SessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      team: user.team,
      role: user.role,
    };
    return { secret, payload: { user: safe, csrfToken: csrf } };
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
      if (!valid || !user || user.status !== 'active')
        throw new ApiError(401, '이메일 또는 비밀번호를 확인해 주세요.');
      // Recheck after async password hashing so a concurrent deactivation cannot reopen access.
      if (store.one<UserRow>('SELECT * FROM users WHERE id=?', user.id)?.status !== 'active')
        throw new ApiError(401, '이메일 또는 비밀번호를 확인해 주세요.');
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
    reply.clearCookie('punchin_session', { path: '/api' });
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
    store.decide(req.auth!.user, req.params.id, data.status, data.reason);
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
