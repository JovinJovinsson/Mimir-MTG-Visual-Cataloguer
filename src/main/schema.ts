import type { Migration } from './migrations.js';

export const INBOX_COLLECTION_NAME = 'Inbox';

export const catalogueMigrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE collections (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          is_wishlist INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE cards (
          id INTEGER PRIMARY KEY,
          scryfall_id TEXT NOT NULL,
          name TEXT NOT NULL,
          set_code TEXT NOT NULL,
          set_name TEXT NOT NULL,
          collector_number TEXT NOT NULL,
          collection_id INTEGER NOT NULL REFERENCES collections(id),
          foil TEXT NOT NULL DEFAULT 'normal',
          condition TEXT NOT NULL DEFAULT 'NM',
          language TEXT NOT NULL DEFAULT 'EN',
          quantity INTEGER NOT NULL DEFAULT 1,
          price_at_first_scan_usd REAL,
          notes TEXT,
          needs_review INTEGER NOT NULL DEFAULT 0,
          review_reasons TEXT,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          UNIQUE (scryfall_id, foil, condition, language, collection_id)
        );

        CREATE INDEX idx_cards_collection ON cards(collection_id);
        CREATE INDEX idx_cards_last_seen ON cards(last_seen_at DESC);

        CREATE TABLE scans (
          id INTEGER PRIMARY KEY,
          card_id INTEGER REFERENCES cards(id),
          captured_at INTEGER NOT NULL,
          thumbnail_path TEXT,
          phash TEXT,
          confidence_score REAL,
          inferences_json TEXT,
          needed_manual_review INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE review_queue (
          id INTEGER PRIMARY KEY,
          scan_id INTEGER REFERENCES scans(id),
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          candidates_json TEXT NOT NULL,
          resolved_scryfall_id TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );

        CREATE INDEX idx_review_queue_status ON review_queue(status);
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

export function seedInboxCollection(db: import('better-sqlite3').Database): void {
  const existing = db
    .prepare<[string], { id: number }>(`SELECT id FROM collections WHERE name = ?`)
    .get(INBOX_COLLECTION_NAME);
  if (existing) return;
  db.prepare(
    `INSERT INTO collections (name, sort_order, created_at) VALUES (?, 0, ?)`,
  ).run(INBOX_COLLECTION_NAME, Date.now());
}
