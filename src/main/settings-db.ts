import type { Database } from 'better-sqlite3';

export interface SettingsDb {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export function openSettingsDb(db: Database): SettingsDb {
  const getStmt = db.prepare<[string], { value: string }>(
    `SELECT value FROM settings WHERE key = ?`,
  );
  const setStmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const deleteStmt = db.prepare(`DELETE FROM settings WHERE key = ?`);

  return {
    get(key: string): string | null {
      return getStmt.get(key)?.value ?? null;
    },
    set(key: string, value: string): void {
      setStmt.run(key, value);
    },
    delete(key: string): void {
      deleteStmt.run(key);
    },
  };
}
