import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './database';
import { createServer } from './app';
if (existsSync('.env')) process.loadEnvFile('.env');
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.APP_ORIGINS)
  throw new Error('운영 환경에는 APP_ORIGINS 설정이 필요합니다.');
const db = openDatabase(resolve(process.env.DATABASE_PATH ?? 'data/punchin.sqlite'));
const { app } = await createServer({
  db,
  secureCookies: production,
  logger: true,
  origins: process.env.APP_ORIGINS?.split(',')
    .map((v) => v.trim())
    .filter(Boolean),
});
await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
