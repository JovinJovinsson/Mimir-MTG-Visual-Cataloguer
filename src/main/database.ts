import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runMigrations } from './migrations.js';
import { catalogueMigrations, seedInboxCollection, INBOX_COLLECTION_NAME } from './schema.js';
import { planCatalogueAddition } from './planner.js';
import type {
  AddCardInput,
  CardForRenderer,
  CardsRow,
  CatalogueAction,
} from '../shared/types.js';

export interface CatalogueDb {
  raw: Database.Database;
  inboxCollectionId(): number;
  addCard(input: Omit<AddCardInput, 'collection_id' | 'now'> & { collection_id?: number; now?: number }): { id: number; created: boolean };
  executeAction(action: CatalogueAction): number;
  findCardByScryfallId(scryfallId: string, foil: string, condition: string, language: string, collectionId: number): CardsRow | null;
  listCards(): CardForRenderer[];
  close(): void;
}

export function openCatalogueDb(dbPath: string): CatalogueDb {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db, catalogueMigrations);
  seedInboxCollection(db);

  return wrap(db);
}

function wrap(db: Database.Database): CatalogueDb {
  const findExisting = db.prepare<
    {
      scryfall_id: string;
      foil: string;
      condition: string;
      language: string;
      collection_id: number;
    },
    CardsRow
  >(`
    SELECT * FROM cards
    WHERE scryfall_id = @scryfall_id
      AND foil = @foil
      AND condition = @condition
      AND language = @language
      AND collection_id = @collection_id
  `);

  const insertCard = db.prepare(`
    INSERT INTO cards (
      scryfall_id, name, set_code, set_name, collector_number, collection_id,
      foil, condition, language, quantity, price_at_first_scan_usd,
      notes, needs_review, review_reasons, first_seen_at, last_seen_at
    ) VALUES (
      @scryfall_id, @name, @set_code, @set_name, @collector_number, @collection_id,
      @foil, @condition, @language, @quantity, @price_at_first_scan_usd,
      @notes, @needs_review, @review_reasons, @first_seen_at, @last_seen_at
    )
  `);

  const bumpCard = db.prepare(
    `UPDATE cards SET quantity = ?, last_seen_at = ? WHERE id = ?`,
  );

  const listAll = db.prepare<[], CardsRow>(
    `SELECT * FROM cards ORDER BY last_seen_at DESC`,
  );

  const inboxIdStmt = db.prepare<[string], { id: number }>(
    `SELECT id FROM collections WHERE name = ?`,
  );

  return {
    raw: db,

    inboxCollectionId(): number {
      const row = inboxIdStmt.get(INBOX_COLLECTION_NAME);
      if (!row) throw new Error('Inbox collection not seeded');
      return row.id;
    },

    addCard(input) {
      const collectionId = input.collection_id ?? this.inboxCollectionId();
      const now = input.now ?? Date.now();
      const fullInput: AddCardInput = { ...input, collection_id: collectionId, now };

      const tx = db.transaction(() => {
        const existing = findExisting.get({
          scryfall_id: fullInput.scryfall_id,
          foil: fullInput.foil,
          condition: fullInput.condition,
          language: fullInput.language,
          collection_id: fullInput.collection_id,
        }) ?? null;

        const action = planCatalogueAddition(existing, fullInput);
        if (action.kind === 'bump') {
          bumpCard.run(action.newQuantity, action.lastSeenAt, action.cardId);
          return { id: action.cardId, created: false };
        }
        const info = insertCard.run(action.row);
        return { id: Number(info.lastInsertRowid), created: true };
      });
      return tx();
    },

    executeAction(action: CatalogueAction): number {
      if (action.kind === 'bump') {
        bumpCard.run(action.newQuantity, action.lastSeenAt, action.cardId);
        return action.cardId;
      }
      const info = insertCard.run(action.row);
      return Number(info.lastInsertRowid);
    },

    findCardByScryfallId(scryfallId: string, foil: string, condition: string, language: string, collectionId: number): CardsRow | null {
      return findExisting.get({ scryfall_id: scryfallId, foil, condition, language, collection_id: collectionId }) ?? null;
    },

    listCards(): CardForRenderer[] {
      const rows = listAll.all();
      return rows.map((r) => ({
        id: r.id,
        scryfall_id: r.scryfall_id,
        name: r.name,
        set_code: r.set_code,
        collector_number: r.collector_number,
        foil: r.foil,
        condition: r.condition,
        language: r.language,
        quantity: r.quantity,
        price_usd: r.price_at_first_scan_usd,
        last_seen_at: r.last_seen_at,
        needs_review: r.needs_review === 1,
      }));
    },

    close() {
      db.close();
    },
  };
}

export function defaultCataloguePath(userDataDir: string): string {
  return join(userDataDir, 'catalogue.db');
}
