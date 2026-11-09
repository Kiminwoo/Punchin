export type SecureStore = {
  get: () => Promise<{ token: string | null }>;
  set: (value: { token: string }) => Promise<void>;
  remove: () => Promise<void>;
};
export type NativeHttp = (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: unknown;
  responseType: 'json';
  disableRedirects: boolean;
  connectTimeout: number;
  readTimeout: number;
}) => Promise<{ status: number; data: unknown }>;
export function nativeApiBase(value: string | undefined) {
  if (!value) throw new Error('회사 서버 주소가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('안전한 회사 서버 주소가 필요합니다. 관리자에게 문의해 주세요.');
  return url.origin;
}
/** Native bearer tokens never enter WebView storage or React state. */
export class NativeSession {
  private token: string | null = null;
  private loaded = false;
  constructor(
    private base: () => string,
    private http: NativeHttp,
    private store: SecureStore,
  ) {}
  async request(path: string, options: { method?: string; body?: unknown; key?: string }) {
    const base = this.base();
    if (!/^\/[a-zA-Z0-9/_?=&.-]*$/.test(path) || path.startsWith('//'))
      throw new Error('잘못된 API 경로입니다.');
    if (!this.loaded) {
      try {
        this.token = (await this.store.get()).token;
        this.loaded = true;
      } catch {
        throw new Error(
          '안전한 로그인 저장소를 열 수 없습니다. 기기 잠금을 해제한 뒤 다시 시도해 주세요.',
        );
      }
    }
    const authentication = ['/auth/login', '/auth/activate', '/auth/reset'].includes(path);
    const route = authentication ? `/mobile${path}` : path;
    const response = await this.http({
      url: `${base}/api${route}`,
      method: options.method ?? 'GET',
      headers: {
        'X-Punchin-Client': 'native',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      ...(options.body !== undefined ? { data: options.body } : {}),
      responseType: 'json',
      disableRedirects: true,
      connectTimeout: 15000,
      readTimeout: 20000,
    });
    if (response.status === 401) {
      this.token = null;
      await this.store.remove();
    }
    if (response.status >= 200 && response.status < 300 && authentication) {
      const data = response.data as { sessionToken?: unknown };
      if (typeof data.sessionToken !== 'string' || data.sessionToken.length < 30)
        throw new Error('서버 인증 응답을 확인하지 못했습니다.');
      const secret = data.sessionToken;
      try {
        await this.store.set({ token: secret });
        this.token = secret;
      } catch {
        // A login that cannot be saved must not leave an accessible session in memory.
        this.token = null;
        await this.http({
          url: `${base}/api/auth/logout`,
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}`, 'X-Punchin-Client': 'native' },
          responseType: 'json',
          disableRedirects: true,
          connectTimeout: 10000,
          readTimeout: 10000,
        }).catch(() => {});
        throw new Error(
          '안전한 로그인 저장소를 사용할 수 없습니다. 기기 잠금을 해제하고 다시 시도해 주세요.',
        );
      }
      const { sessionToken: _secret, ...safe } = response.data as Record<string, unknown>;
      return { ...response, data: safe };
    }
    if (response.status >= 200 && response.status < 300 && path === '/auth/logout') {
      this.token = null;
      await this.store.remove();
    }
    return response;
  }
}
