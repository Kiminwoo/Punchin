import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function createBackup(source: string, destination: string) {
  source = resolve(source);
  destination = resolve(destination);
  if (source === destination || !existsSync(source))
    throw new Error('백업 원본 경로를 확인해 주세요.');
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const reservation = openSync(destination, 'wx', 0o600);
  closeSync(reservation);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, destination);
    chmodSync(destination, 0o600);
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      const result = check.prepare('PRAGMA integrity_check').get();
      if (!result || Object.values(result)[0] !== 'ok') throw new Error('백업 무결성 검사 실패');
    } finally {
      check.close();
    }
    return destination;
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  } finally {
    db.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = process.env.DATABASE_PATH ?? 'data/punchin.sqlite';
  const destination =
    process.argv[2] ?? `/backups/punchin-${new Date().toISOString().replaceAll(':', '-')}.backup`;
  await createBackup(source, destination);
  console.log('백업 생성과 무결성 검사를 완료했습니다.');
}
