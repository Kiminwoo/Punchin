import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { NativeSession, nativeApiBase, type SecureStore } from './native-session';
import type { SessionUser, Snapshot } from '@punchin/contracts';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const native = Capacitor.isNativePlatform()
  ? new NativeSession(
      () => nativeApiBase(import.meta.env.VITE_API_BASE_URL),
      (options) => CapacitorHttp.request(options),
      registerPlugin<SecureStore>('SecureSession'),
    )
  : null;
let csrf = '';
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; key?: string } = {},
): Promise<T> {
  if (native) {
    let response: { status: number; data: unknown };
    try {
      response = await native.request(path, options);
    } catch (error) {
      throw error instanceof Error
        ? error
        : new HttpError(0, '서버에 연결하지 못했습니다. 다시 확인해 주세요.');
    }
    if (response.status < 200 || response.status >= 300)
      throw new HttpError(
        response.status,
        typeof (response.data as { message?: unknown })?.message === 'string'
          ? (response.data as { message: string }).message
          : '요청을 처리하지 못했습니다.',
      );
    return response.data as T;
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new HttpError(0, '서버에 연결할 수 없습니다. 저장 결과는 다시 연결한 후 확인해 주세요.');
  }
  const data = await response.json().catch(() => ({ message: 'API 응답을 확인할 수 없습니다.' }));
  if (!response.ok)
    throw new HttpError(
      response.status,
      typeof data.message === 'string' ? data.message : '요청을 처리하지 못했습니다.',
    );
  return data as T;
}
export type SessionResponse = { user: SessionUser; csrfToken: string };
export function setSession(session: SessionResponse | null) {
  csrf = session?.csrfToken ?? '';
}
export async function fetchWorkspace() {
  const data = await api<Snapshot>('/workspace');
  if (
    !data?.user?.id ||
    !data.day ||
    !Array.isArray(data.requests) ||
    !Number.isFinite(Date.parse(data.serverNow))
  )
    throw new Error('서버 데이터 형식을 확인할 수 없습니다.');
  return data;
}
