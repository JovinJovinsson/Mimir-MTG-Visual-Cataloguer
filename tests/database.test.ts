import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalogueDb, defaultCataloguePath, type CatalogueDb } from '../src/main/database.js';

let tmpDir: string;
let db: CatalogueDb;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mimir-test-'));
  db = openCatalogueDb(defaultCataloguePath(tmpDir));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const bolt = {
  scryfall_id: 'sf-bolt',
  name: 'Lightning Bolt',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
  foil: 'normal' as const,
  condition: 'NM' as const,
  language: 'EN',
  price_usd: 1.23,
};

describe('openCatalogueDb', () => {
  it('seeds the Inbox collection', () => {
    const id = db.inboxCollectionId();
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('inserts a card and lists it back', () => {
    const result = db.addCard({ ...bolt, now: 100 });
    expect(result.created).toBe(true);
    const rows = db.listCards();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Lightning Bolt');
    expect(rows[0]?.quantity).toBe(1);
  });

  it('bumps quantity when the same printing is added again', () => {
    const first = db.addCard({ ...bolt, now: 100 });
    const second = db.addCard({ ...bolt, now: 200 });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    const rows = db.listCards();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(2);
    expect(rows[0]?.last_seen_at).toBe(200);
  });

  it('treats foil variants as distinct rows', () => {
    db.addCard({ ...bolt, now: 100 });
    db.addCard({ ...bolt, foil: 'foil', now: 200 });
    expect(db.listCards()).toHaveLength(2);
  });

  it('persists data across reopen', () => {
    const dbPath = defaultCataloguePath(tmpDir);
    db.addCard({ ...bolt, now: 100 });
    db.close();
    db = openCatalogueDb(dbPath);
    const rows = db.listCards();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scryfall_id).toBe('sf-bolt');
  });

  it('runs migrations idempotently on reopen (no errors, single Inbox)', () => {
    db.close();
    db = openCatalogueDb(defaultCataloguePath(tmpDir));
    const rows = db.raw
      .prepare(`SELECT COUNT(*) AS c FROM collections WHERE name = 'Inbox'`)
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('orders listed cards by last_seen_at DESC', () => {
    db.addCard({ ...bolt, scryfall_id: 'sf-a', now: 100 });
    db.addCard({ ...bolt, scryfall_id: 'sf-b', now: 300 });
    db.addCard({ ...bolt, scryfall_id: 'sf-c', now: 200 });
    const rows = db.listCards();
    expect(rows.map((r) => r.scryfall_id)).toEqual(['sf-b', 'sf-c', 'sf-a']);
  });
});
