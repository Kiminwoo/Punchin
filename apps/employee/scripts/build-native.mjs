import { loadEnv } from 'vite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const env = loadEnv('production', process.cwd(), 'VITE_');
const value = env.VITE_API_BASE_URL;
if (!value)
  throw new Error(
    '네이티브 빌드에는 VITE_API_BASE_URL이 필요합니다. .env.production.local에 회사 HTTPS 서버 Origin을 설정하세요.',
  );
const url = new URL(value);
if (
  url.protocol !== 'https:' ||
  url.pathname !== '/' ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error('VITE_API_BASE_URL에는 경로 없는 HTTPS Origin만 허용됩니다.');
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build'],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
