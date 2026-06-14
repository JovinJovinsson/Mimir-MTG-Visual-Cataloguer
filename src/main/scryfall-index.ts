import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runMigrations, type Migration } from './migrations.js';
import type {
  IndexState,
  InsertBatch,
  ScryfallCardInsert,
} from './scryfall-bootstrap.js';

export const SCRYFALL_INDEX_SUBDIR = 'scryfall-index';
export const SCRYFALL_INDEX_FILENAME = 'scryfall_index.db';

export function defaultScryfallIndexPath(userDataDir: string): string {
  return join(userDataDir, SCRYFALL_INDEX_SUBDIR, SCRYFALL_INDEX_FILENAME);
}

export const scryfallIndexMigrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE scryfall_sets (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );

        CREATE TABLE scryfall_cards (
          scryfall_id TEXT PRIMARY KEY,
          oracle_id TEXT,
          name TEXT NOT NULL,
          set_code TEXT NOT NULL,
          set_name TEXT NOT NULL,
          collector_number TEXT NOT NULL,
          released_at TEXT,
          type_line TEXT,
          oracle_text TEXT,
          mana_cost TEXT,
          cmc REAL,
          colors_json TEXT,
          color_identity_json TEXT,
          rarity TEXT,
          lang TEXT NOT NULL DEFAULT 'en',
          image_art_crop_url TEXT,
          image_normal_url TEXT,
          image_small_url TEXT,
          price_usd REAL,
          price_usd_foil REAL,
          finishes_json TEXT NOT NULL,
          layout TEXT,
          is_digital INTEGER NOT NULL DEFAULT 0,
          phash TEXT,
          art_crop_path TEXT
        );

        CREATE INDEX idx_scryfall_cards_name ON scryfall_cards(name COLLATE NOCASE);
        CREATE INDEX idx_scryfall_cards_set ON scryfall_cards(set_code);

        CREATE TABLE scryfall_meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
    },
  },
];

const META_KEY_BULK_FETCHED_AT = 'bulk_data_last_fetched_at';

export interface ScryfallIndexCard {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  released_at: string | null;
  image_art_crop_url: string | null;
  image_normal_url: string | null;
  image_small_url: string | null;
  price_usd: number | null;
}

export interface AutocompleteHit {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
}

export interface ScryfallIndexDb {
  raw: Database.Database;
  getIndexState(): IndexState;
  ingestBatches(batches: InsertBatch[]): { setsUpserted: number; cardsUpserted: number };
  markBulkFetched(timestampMs: number): void;
  autocompleteByName(query: string, limit: number): AutocompleteHit[];
  getCardByScryfallId(id: string): ScryfallIndexCard | null;
  close(): void;
}

export function openScryfallIndexDb(dbPath: string): ScryfallIndexDb {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db, scryfallIndexMigrations);

  return wrap(db);
}

function wrap(db: Database.Database): ScryfallIndexDb {
  const countCards = db.prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM scryfall_cards`);
  const countSets = db.prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM scryfall_sets`);
  const getMeta = db.prepare<[string], { value: string }>(
    `SELECT value FROM scryfall_meta WHERE key = ?`,
  );
  const setMeta = db.prepare(
    `INSERT INTO scryfall_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  const upsertSet = db.prepare(`
    INSERT INTO scryfall_sets (code, name) VALUES (@code, @name)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name
  `);

  const upsertCard = db.prepare(`
    INSERT INTO scryfall_cards (
      scryfall_id, oracle_id, name, set_code, set_name, collector_number,
      released_at, type_line, oracle_text, mana_cost, cmc,
      colors_json, color_identity_json, rarity, lang,
      image_art_crop_url, image_normal_url, image_small_url,
      price_usd, price_usd_foil, finishes_json, layout, is_digital,
      phash, art_crop_path
    ) VALUES (
      @scryfall_id, @oracle_id, @name, @set_code, @set_name, @collector_number,
      @released_at, @type_line, @oracle_text, @mana_cost, @cmc,
      @colors_json, @color_identity_json, @rarity, @lang,
      @image_art_crop_url, @image_normal_url, @image_small_url,
      @price_usd, @price_usd_foil, @finishes_json, @layout, @is_digital,
      @phash, @art_crop_path
    )
    ON CONFLICT(scryfall_id) DO UPDATE SET
      oracle_id = excluded.oracle_id,
      name = excluded.name,
      set_code = excluded.set_code,
      set_name = excluded.set_name,
      collector_number = excluded.collector_number,
      released_at = excluded.released_at,
      type_line = excluded.type_line,
      oracle_text = excluded.oracle_text,
      mana_cost = excluded.mana_cost,
      cmc = excluded.cmc,
      colors_json = excluded.colors_json,
      color_identity_json = excluded.color_identity_json,
      rarity = excluded.rarity,
      lang = excluded.lang,
      image_art_crop_url = excluded.image_art_crop_url,
      image_normal_url = excluded.image_normal_url,
      image_small_url = excluded.image_small_url,
      price_usd = excluded.price_usd,
      price_usd_foil = excluded.price_usd_foil,
      finishes_json = excluded.finishes_json,
      layout = excluded.layout,
      is_digital = excluded.is_digital
  `);

  const autocompleteStmt = db.prepare<
    { q: string; limit: number },
    AutocompleteHit
  >(`
    SELECT scryfall_id, name, set_code, set_name, collector_number
    FROM scryfall_cards
    WHERE name LIKE @q COLLATE NOCASE
    ORDER BY
      CASE WHEN name LIKE @q COLLATE NOCASE THEN 0 ELSE 1 END,
      released_at DESC,
      name
    LIMIT @limit
  `);

  const getCardStmt = db.prepare<[string], ScryfallIndexCard>(`
    SELECT scryfall_id, name, set_code, set_name, collector_number, released_at,
           image_art_crop_url, image_normal_url, image_small_url, price_usd
    FROM scryfall_cards
    WHERE scryfall_id = ?
  `);

  return {
    raw: db,

    getIndexState(): IndexState {
      const cardCount = countCards.get()?.c ?? 0;
      const setCount = countSets.get()?.c ?? 0;
      const metaRow = getMeta.get(META_KEY_BULK_FETCHED_AT);
      const ts = metaRow?.value ? Number(metaRow.value) : null;
      return {
        hasIndex: true,
        cardCount,
        setCount,
        bulkDataLastFetchedAt: Number.isFinite(ts as number) ? (ts as number) : null,
      };
    },

    ingestBatches(batches: InsertBatch[]) {
      let setsUpserted = 0;
      let cardsUpserted = 0;
      const tx = db.transaction((bs: InsertBatch[]) => {
        for (const batch of bs) {
          for (const s of batch.sets) {
            upsertSet.run(s);
            setsUpserted++;
          }
          for (const c of batch.cards) {
            upsertCard.run(toRow(c));
            cardsUpserted++;
          }
        }
      });
      tx(batches);
      return { setsUpserted, cardsUpserted };
    },

    markBulkFetched(timestampMs: number) {
      setMeta.run(META_KEY_BULK_FETCHED_AT, String(timestampMs));
    },

    autocompleteByName(query: string, limit: number): AutocompleteHit[] {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const like = `${trimmed.replace(/[%_]/g, '\\$&')}%`;
      return autocompleteStmt.all({ q: like, limit });
    },

    getCardByScryfallId(id: string): ScryfallIndexCard | null {
      return getCardStmt.get(id) ?? null;
    },

    close() {
      db.close();
    },
  };
}

function toRow(c: ScryfallCardInsert): Record<string, unknown> {
  return { ...c };
}
