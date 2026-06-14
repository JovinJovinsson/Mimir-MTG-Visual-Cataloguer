import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, type Migration } from '../src/main/migrations.js';

function freshDb(): Database.Database {
  return new Database(':memory:');
}

const noopMigrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`CREATE TABLE t1 (id INTEGER PRIMARY KEY, x TEXT)`);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`CREATE TABLE t2 (id INTEGER PRIMARY KEY, y TEXT)`);
    },
  },
];

describe('runMigrations', () => {
  it('creates schema_version table on a fresh DB', () => {
    const db = freshDb();
    runMigrations(db, noopMigrations);
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`)
      .get();
    expect(row).toBeDefined();
  });

  it('runs all migrations on a fresh DB and reports applied versions', () => {
    const db = freshDb();
    const result = runMigrations(db, noopMigrations);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(2);
    expect(result.applied).toEqual([1, 2]);
    const t1 = db.prepare(`SELECT name FROM sqlite_master WHERE name='t1'`).get();
    const t2 = db.prepare(`SELECT name FROM sqlite_master WHERE name='t2'`).get();
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
  });

  it('records the latest version in schema_version', () => {
    const db = freshDb();
    runMigrations(db, noopMigrations);
    const row = db
      .prepare<[], { version: number }>(`SELECT MAX(version) AS version FROM schema_version`)
      .get();
    expect(row?.version).toBe(2);
  });

  it('does not re-run already-applied migrations', () => {
    const db = freshDb();
    runMigrations(db, noopMigrations);
    const result = runMigrations(db, noopMigrations);
    expect(result.fromVersion).toBe(2);
    expect(result.toVersion).toBe(2);
    expect(result.applied).toEqual([]);
  });

  it('applies only the missing migrations on a partially-versioned DB', () => {
    const db = freshDb();
    runMigrations(db, noopMigrations.slice(0, 1));
    const result = runMigrations(db, noopMigrations);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
    expect(result.applied).toEqual([2]);
  });

  it('runs migrations in version order regardless of array order', () => {
    const db = freshDb();
    const result = runMigrations(db, [noopMigrations[1]!, noopMigrations[0]!]);
    expect(result.applied).toEqual([1, 2]);
  });

  it('rolls back a failing migration (transactional)', () => {
    const db = freshDb();
    const bad: Migration[] = [
      noopMigrations[0]!,
      {
        version: 2,
        up: (db) => {
          db.exec(`CREATE TABLE t2 (id INTEGER PRIMARY KEY)`);
          throw new Error('boom');
        },
      },
    ];
    expect(() => runMigrations(db, bad)).toThrow(/boom/);
    const t1 = db.prepare(`SELECT name FROM sqlite_master WHERE name='t1'`).get();
    const t2 = db.prepare(`SELECT name FROM sqlite_master WHERE name='t2'`).get();
    expect(t1).toBeDefined();
    expect(t2).toBeUndefined();
    const version = db
      .prepare<[], { version: number | null }>(`SELECT MAX(version) AS version FROM schema_version`)
      .get();
    expect(version?.version).toBe(1);
  });

  it('throws on duplicate migration versions', () => {
    const db = freshDb();
    const dupes: Migration[] = [
      { version: 1, up: () => {} },
      { version: 1, up: () => {} },
    ];
    expect(() => runMigrations(db, dupes)).toThrow(/duplicate/i);
  });
});
