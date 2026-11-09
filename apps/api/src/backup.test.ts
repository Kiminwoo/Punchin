import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup } from './backup';
it('backs up a running WAL database, verifies it, restores independent data and refuses overwrites', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'punchin-backup-'));
  const path = join(dir, 'source.sqlite'),
    destination = join(dir, 'backup.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE sample(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO sample VALUES(1,'preserved');",
    );
    await createBackup(path, destination);
    const restored = new DatabaseSync(destination);
    try {
      expect(restored.prepare('SELECT value FROM sample WHERE id=1').get()).toMatchObject({
        value: 'preserved',
      });
      db.prepare('UPDATE sample SET value=? WHERE id=1').run('changed');
      expect(restored.prepare('SELECT value FROM sample WHERE id=1').get()).toMatchObject({
        value: 'preserved',
      });
    } finally {
      restored.close();
    }
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    await expect(createBackup(path, destination)).rejects.toThrow();
    await expect(createBackup(path, path)).rejects.toThrow();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
