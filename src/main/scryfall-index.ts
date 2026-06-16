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
  {
    version: 2,
    up: (db) => {
      db.exec(`
        ALTER TABLE scryfall_sets ADD COLUMN download_status TEXT NOT NULL DEFAULT 'none';
        ALTER TABLE scryfall_sets ADD COLUMN is_downloaded INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
];

export type SetDownloadStatus = 'none' | 'downloading' | 'complete' | 'error';

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

export interface ScryfallSetWithStatus {
  code: string;
  name: string;
  card_count: number;
  hashed_count: number;
  download_status: SetDownloadStatus;
  is_downloaded: number;
}

export interface ScryfallSetForWizard {
  code: string;
  name: string;
  card_count: number;
  released_at: string | null;
  download_status: SetDownloadStatus;
  is_downloaded: number;
}

export interface ScryfallCardCropRow {
  scryfall_id: string;
  image_art_crop_url: string | null;
  phash: string | null;
  art_crop_path: string | null;
}

export interface HashedCard {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  price_usd: number | null;
  phash: string;
}

export interface HashedCardWithCrop extends HashedCard {
  art_crop_path: string | null;
  lang: string;
  price_usd_foil: number | null;
}

export interface ScryfallIndexDb {
  raw: Database.Database;
  getIndexState(): IndexState;
  ingestBatches(batches: InsertBatch[]): { setsUpserted: number; cardsUpserted: number };
  markBulkFetched(timestampMs: number): void;
  autocompleteByName(query: string, limit: number): AutocompleteHit[];
  getCardByScryfallId(id: string): ScryfallIndexCard | null;
  listSetsWithStatus(): ScryfallSetWithStatus[];
  listSetsForWizard(): ScryfallSetForWizard[];
  listSetCropRows(setCode: string): ScryfallCardCropRow[];
  getAllHashedCards(): HashedCard[];
  getAllHashedCardsWithCrop(): HashedCardWithCrop[];
  setSetDownloadStatus(
    setCode: string,
    status: SetDownloadStatus,
    isDownloaded: boolean,
  ): void;
  updateCardCrop(scryfallId: string, phash: string, artCropPath: string): void;
  clearSetCrops(setCode: string): void;
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

  const listSetsWithStatusStmt = db.prepare<[], ScryfallSetWithStatus>(`
    SELECT
      s.code AS code,
      s.name AS name,
      COALESCE(c.card_count, 0) AS card_count,
      COALESCE(c.hashed_count, 0) AS hashed_count,
      s.download_status AS download_status,
      s.is_downloaded AS is_downloaded
    FROM scryfall_sets s
    LEFT JOIN (
      SELECT
        set_code,
        COUNT(*) AS card_count,
        SUM(CASE WHEN phash IS NOT NULL THEN 1 ELSE 0 END) AS hashed_count
      FROM scryfall_cards
      GROUP BY set_code
    ) c ON c.set_code = s.code
    ORDER BY s.name COLLATE NOCASE
  `);

  const listSetsForWizardStmt = db.prepare<[], ScryfallSetForWizard>(`
    SELECT
      s.code AS code,
      s.name AS name,
      COALESCE(c.card_count, 0) AS card_count,
      c.released_at AS released_at,
      s.download_status AS download_status,
      s.is_downloaded AS is_downloaded
    FROM scryfall_sets s
    LEFT JOIN (
      SELECT
        set_code,
        COUNT(*) AS card_count,
        MAX(released_at) AS released_at
      FROM scryfall_cards
      GROUP BY set_code
    ) c ON c.set_code = s.code
    ORDER BY c.released_at DESC NULLS LAST, s.name COLLATE NOCASE
  `);

  const listSetCropRowsStmt = db.prepare<[string], ScryfallCardCropRow>(`
    SELECT scryfall_id, image_art_crop_url, phash, art_crop_path
    FROM scryfall_cards
    WHERE set_code = ?
  `);

  const getAllHashedCardsStmt = db.prepare<[], HashedCard>(`
    SELECT scryfall_id, name, set_code, set_name, collector_number, price_usd, phash
    FROM scryfall_cards
    WHERE phash IS NOT NULL
  `);

  const getAllHashedCardsWithCropStmt = db.prepare<[], HashedCardWithCrop>(`
    SELECT scryfall_id, name, set_code, set_name, collector_number, price_usd, phash, art_crop_path,
           COALESCE(lang, 'en') AS lang, price_usd_foil
    FROM scryfall_cards
    WHERE phash IS NOT NULL
  `);

  const updateSetStatusStmt = db.prepare(`
    UPDATE scryfall_sets
    SET download_status = @status, is_downloaded = @is_downloaded
    WHERE code = @code
  `);

  const updateCardCropStmt = db.prepare(`
    UPDATE scryfall_cards
    SET phash = @phash, art_crop_path = @art_crop_path
    WHERE scryfall_id = @scryfall_id
  `);

  const clearSetCropsStmt = db.prepare(`
    UPDATE scryfall_cards
    SET phash = NULL, art_crop_path = NULL
    WHERE set_code = ?
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

    listSetsWithStatus(): ScryfallSetWithStatus[] {
      return listSetsWithStatusStmt.all();
    },

    listSetsForWizard(): ScryfallSetForWizard[] {
      return listSetsForWizardStmt.all();
    },

    listSetCropRows(setCode: string): ScryfallCardCropRow[] {
      return listSetCropRowsStmt.all(setCode);
    },

    getAllHashedCards(): HashedCard[] {
      return getAllHashedCardsStmt.all();
    },

    getAllHashedCardsWithCrop(): HashedCardWithCrop[] {
      return getAllHashedCardsWithCropStmt.all();
    },

    setSetDownloadStatus(
      setCode: string,
      status: SetDownloadStatus,
      isDownloaded: boolean,
    ): void {
      updateSetStatusStmt.run({
        code: setCode,
        status,
        is_downloaded: isDownloaded ? 1 : 0,
      });
    },

    updateCardCrop(scryfallId: string, phash: string, artCropPath: string): void {
      updateCardCropStmt.run({
        scryfall_id: scryfallId,
        phash,
        art_crop_path: artCropPath,
      });
    },

    clearSetCrops(setCode: string): void {
      clearSetCropsStmt.run(setCode);
    },

    close() {
      db.close();
    },
  };
}

function toRow(c: ScryfallCardInsert): Record<string, unknown> {
  return { ...c };
}
