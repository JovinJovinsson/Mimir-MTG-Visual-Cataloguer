import type { Database } from 'better-sqlite3';

export interface Migration {
  version: number;
  up: (db: Database) => void;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
}

function ensureSchemaVersionTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

function currentVersion(db: Database): number {
  const row = db
    .prepare<[], { version: number | null }>(`SELECT MAX(version) AS version FROM schema_version`)
    .get();
  return row?.version ?? 0;
}

export function runMigrations(db: Database, migrations: Migration[]): MigrationResult {
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`runMigrations: duplicate migration version ${m.version}`);
    }
    seen.add(m.version);
  }
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  ensureSchemaVersionTable(db);
  const fromVersion = currentVersion(db);
  const pending = sorted.filter((m) => m.version > fromVersion);
  const applied: number[] = [];

  const record = db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`);

  for (const migration of pending) {
    const tx = db.transaction(() => {
      migration.up(db);
      record.run(migration.version, Date.now());
    });
    tx();
    applied.push(migration.version);
  }

  return { fromVersion, toVersion: currentVersion(db), applied };
}
