import { describe, expect, it, vi } from 'vitest';
import { NativeSession, nativeApiBase, type NativeHttp, type SecureStore } from './native-session';
const secret = 's'.repeat(43);
function store(value: string | null = null): SecureStore {
  return {
    get: vi.fn(async () => ({ token: value })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
}
describe('native session transport', () => {
  it.each([
    'http://api.example.test',
    'https://user:pass@api.example.test',
    'https://api.example.test/path',
    'https://api.example.test?x=1',
    'https://api.example.test#token',
    undefined,
  ])('refuses unsafe or unconfigured server %s', (value) =>
    expect(() => nativeApiBase(value)).toThrow(),
  );
  it('uses HTTPS, disables redirects, persists only in native storage and strips tokens from UI responses', async () => {
    const storage = store();
    const http = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: { user: { id: 'one' }, csrfToken: '', sessionToken: secret },
      })
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const client = new NativeSession(
      () => nativeApiBase('https://api.example.test'),
      http,
      storage,
    );
    const result = await client.request('/auth/login', {
      method: 'POST',
      body: { email: 'staff@example.test', password: 'test-only-password' },
    });
    expect(result.data).not.toHaveProperty('sessionToken');
    expect(storage.set).toHaveBeenCalledWith({ token: secret });
    await client.request('/workspace', {});
    expect(http.mock.calls[0]![0]).toMatchObject({
      url: 'https://api.example.test/api/mobile/auth/login',
      disableRedirects: true,
    });
    expect(http.mock.calls[1]![0].headers.Authorization).toBe(`Bearer ${secret}`);
  });
  it('restores a stored session and removes it when server revokes access', async () => {
    const storage = store(secret);
    const http = vi.fn(async (_options: Parameters<NativeHttp>[0]) => ({
      status: 401,
      data: { message: 'expired' },
    }));
    const client = new NativeSession(() => 'https://api.example.test', http, storage);
    await client.request('/workspace', {});
    expect(storage.remove).toHaveBeenCalledOnce();
    await client.request('/workspace', {});
    expect(http.mock.calls[1]![0].headers).not.toHaveProperty('Authorization');
  });
  it('revokes a newly issued session when secure storage fails, without falling back to plaintext', async () => {
    const storage = store();
    storage.set = vi.fn(async () => {
      throw new Error('locked');
    });
    const http = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { sessionToken: secret } })
      .mockResolvedValue({ status: 200, data: { ok: true } });
    const client = new NativeSession(() => 'https://api.example.test', http, storage);
    await expect(client.request('/auth/login', { method: 'POST' })).rejects.toThrow('저장소');
    expect(http.mock.calls[1]![0].url).toContain('/auth/logout');
  });
  it('removes a token after successful logout and disallows endpoint escape', async () => {
    const storage = store(secret);
    const client = new NativeSession(
      () => 'https://api.example.test',
      vi.fn(async () => ({ status: 200, data: { ok: true } })),
      storage,
    );
    await client.request('/auth/logout', { method: 'POST' });
    expect(storage.remove).toHaveBeenCalledOnce();
    await expect(client.request('//evil.example', {})).rejects.toThrow();
  });
});
