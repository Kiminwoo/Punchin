import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`,
  );
  if (!db.prepare('SELECT version FROM migrations WHERE version=1').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, team TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','employee')), status TEXT NOT NULL CHECK(status IN ('active','invited','inactive')), password_hash TEXT, created_at TEXT NOT NULL);
      CREATE TABLE invitations (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, used_at TEXT);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE attendance (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), work_date TEXT NOT NULL, start_at TEXT, end_at TEXT, corrected_start TEXT, version INTEGER NOT NULL DEFAULT 1, policy_version TEXT NOT NULL, verification TEXT NOT NULL DEFAULT 'not_configured', UNIQUE(user_id, work_date));
      CREATE TABLE requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL, time TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')), created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT REFERENCES users(id), decision_reason TEXT, base_version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, recorded_at TEXT NOT NULL, attendance_id TEXT REFERENCES attendance(id), policy_version TEXT NOT NULL, verification TEXT NOT NULL);
      CREATE TABLE idempotency (user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,key));
      CREATE TABLE audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, subject_id TEXT NOT NULL, detail TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE INDEX attendance_user_date ON attendance(user_id,work_date);
      CREATE INDEX request_user_status ON requests(user_id,status);
      CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
      CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
      CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
      CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
      INSERT INTO migrations VALUES(1,datetime('now'));
      COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=2').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE office (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL);
      ALTER TABLE events ADD COLUMN evidence TEXT;
      INSERT INTO migrations VALUES(2,datetime('now'));`);
    db.prepare('INSERT INTO office VALUES(1,?)').run(
      JSON.stringify({
        name: '휴데이터스 가산 오피스',
        address: '서울 금천구 가산디지털2로 83 한진물류터미널 사무동 7F 휴데이터스',
        latitude: null,
        longitude: null,
        radius: 150,
        enabled: false,
        confirmed: false,
        revision: 1,
      }),
    );
    db.exec('COMMIT');
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=3').get()) {
    db.exec(
      `BEGIN IMMEDIATE; ALTER TABLE attendance ADD COLUMN corrected_end TEXT; ALTER TABLE requests ADD COLUMN field TEXT NOT NULL DEFAULT 'start'; INSERT INTO migrations VALUES(3,datetime('now')); COMMIT;`,
    );
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=4').get()) {
    db.exec(
      `BEGIN IMMEDIATE; ALTER TABLE sessions ADD COLUMN transport TEXT NOT NULL DEFAULT 'web' CHECK(transport IN ('web','native')); INSERT INTO migrations VALUES(4,datetime('now')); COMMIT;`,
    );
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=5').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE month_closures(month TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('open','closed')),version INTEGER NOT NULL,snapshot TEXT,closed_at TEXT,closed_by TEXT REFERENCES users(id));
      CREATE TABLE month_history(id TEXT PRIMARY KEY,month TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),recorded_at TEXT NOT NULL);
      CREATE TABLE password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,used_at TEXT);
      ALTER TABLE users ADD COLUMN reset_required INTEGER NOT NULL DEFAULT 0;
      INSERT INTO migrations VALUES(5,datetime('now')); COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=6').get()) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE requests ADD COLUMN requested_minutes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE requests ADD COLUMN approved_minutes INTEGER;
      CREATE TABLE leave_ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('adjustment','used','refunded')),minutes INTEGER NOT NULL,request_id TEXT REFERENCES requests(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),recorded_at TEXT NOT NULL);
      CREATE UNIQUE INDEX leave_once ON leave_ledger(request_id,kind) WHERE request_id IS NOT NULL;
      CREATE TABLE leave_cancellations(request_id TEXT PRIMARY KEY REFERENCES requests(id),status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),requested_at TEXT NOT NULL,decided_at TEXT,decided_by TEXT REFERENCES users(id),reason TEXT);
      CREATE TRIGGER leave_ledger_no_update BEFORE UPDATE ON leave_ledger BEGIN SELECT RAISE(ABORT,'immutable leave ledger'); END;
      CREATE TRIGGER leave_ledger_no_delete BEFORE DELETE ON leave_ledger BEGIN SELECT RAISE(ABORT,'immutable leave ledger'); END;
      UPDATE requests SET requested_minutes=CASE WHEN type='연차' AND start_date=end_date THEN 480 WHEN type IN ('오전 반차','오후 반차') THEN 240 ELSE 0 END;
      INSERT INTO migrations VALUES(6,datetime('now')); COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=7').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE mfa_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,enabled INTEGER NOT NULL,last_counter INTEGER NOT NULL);
      CREATE TABLE mfa_enrollments(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,expires_at TEXT NOT NULL);
      CREATE TABLE mfa_recovery(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),used_at TEXT);
      INSERT INTO migrations VALUES(7,datetime('now')); COMMIT;`);
  }
  if (path !== ':memory:') chmodSync(path, 0o600);
  return db;
}
export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
