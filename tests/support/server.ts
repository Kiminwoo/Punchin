// Explicit test-only entrypoint. Never used by the production server.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../apps/api/src/database';
import { createServer } from '../../apps/api/src/app';
if (process.env.NODE_ENV !== 'test')
  throw new Error('This entrypoint is for automated tests only.');
const dir = mkdtempSync(join(tmpdir(), 'punchin-browser-'));
const db = openDatabase(join(dir, 'test.sqlite'));
const { app, store } = await createServer({
  db,
  now: () => new Date('2026-11-09T01:00:00Z'),
  origins: ['http://127.0.0.1:5373', 'http://127.0.0.1:5374'],
});
await store.createAdmin('admin@example.test', '테스트관리자', 'Browser-tests-only-42!');
await app.listen({ host: '127.0.0.1', port: 5390 });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  });
