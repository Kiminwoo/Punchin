import type { SessionUser, Snapshot } from '@punchin/contracts';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let csrf = '';
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; key?: string } = {},
): Promise<T> {
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
