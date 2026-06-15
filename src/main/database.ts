import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runMigrations } from './migrations.js';
import { catalogueMigrations, seedDefaultCollections, INBOX_COLLECTION_NAME } from './schema.js';
import { planCatalogueAddition } from './planner.js';
import type {
  AddCardInput,
  CardForRenderer,
  CardsRow,
  CatalogueAction,
  CollectionForRenderer,
  CollectionRow,
} from '../shared/types.js';

export interface CatalogueDb {
  raw: Database.Database;
  inboxCollectionId(): number;
  addCard(input: Omit<AddCardInput, 'collection_id' | 'now'> & { collection_id?: number; now?: number }): { id: number; created: boolean };
  executeAction(action: CatalogueAction): number;
  findCardByScryfallId(scryfallId: string, foil: string, condition: string, language: string, collectionId: number): CardsRow | null;
  findCardById(cardId: number): CardsRow | null;
  findCardInCollection(scryfallId: string, foil: string, condition: string, language: string, collectionId: number): CardsRow | null;
  listCards(): CardForRenderer[];
  listCollections(): CollectionForRenderer[];
  createCollection(name: string): number;
  renameCollection(id: number, name: string): void;
  deleteCollection(id: number, mode: 'delete-cards' | 'move-cards', targetCollectionId?: number): void;
  close(): void;
}

export function openCatalogueDb(dbPath: string): CatalogueDb {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db, catalogueMigrations);
  seedDefaultCollections(db);

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

  const updateCardCollection = db.prepare(
    `UPDATE cards SET collection_id = ? WHERE id = ?`,
  );

  const deleteCard = db.prepare(
    `DELETE FROM cards WHERE id = ?`,
  );

  const listAll = db.prepare<[], CardsRow>(
    `SELECT * FROM cards ORDER BY last_seen_at DESC`,
  );

  const inboxIdStmt = db.prepare<[string], { id: number }>(
    `SELECT id FROM collections WHERE name = ?`,
  );

  const findById = db.prepare<[number], CardsRow>(
    `SELECT * FROM cards WHERE id = ?`,
  );

  const listCollectionsStmt = db.prepare<[], CollectionRow & { count: number }>(`
    SELECT c.id, c.name, c.is_wishlist, c.sort_order, c.created_at,
           COALESCE(SUM(ca.quantity), 0) AS count
    FROM collections c
    LEFT JOIN cards ca ON ca.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.created_at ASC
  `);

  const insertCollection = db.prepare(
    `INSERT INTO collections (name, is_wishlist, sort_order, created_at) VALUES (?, 0, 999, ?)`,
  );

  const renameCollectionStmt = db.prepare(
    `UPDATE collections SET name = ? WHERE id = ?`,
  );

  const deleteCollectionStmt = db.prepare(
    `DELETE FROM collections WHERE id = ?`,
  );

  const moveCardsToCollection = db.prepare(
    `UPDATE cards SET collection_id = ? WHERE collection_id = ?`,
  );

  const deleteCardsByCollection = db.prepare(
    `DELETE FROM cards WHERE collection_id = ?`,
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
      switch (action.kind) {
        case 'bump':
          bumpCard.run(action.newQuantity, action.lastSeenAt, action.cardId);
          return action.cardId;
        case 'update-collection':
          updateCardCollection.run(action.collectionId, action.cardId);
          return action.cardId;
        case 'delete-card':
          deleteCard.run(action.cardId);
          return action.cardId;
        default: {
          const insertAction = action as Extract<CatalogueAction, { kind: 'insert' }>;
          const info = insertCard.run(insertAction.row);
          return Number(info.lastInsertRowid);
        }
      }
    },

    findCardByScryfallId(scryfallId: string, foil: string, condition: string, language: string, collectionId: number): CardsRow | null {
      return findExisting.get({ scryfall_id: scryfallId, foil, condition, language, collection_id: collectionId }) ?? null;
    },

    findCardById(cardId: number): CardsRow | null {
      return findById.get(cardId) ?? null;
    },

    findCardInCollection(scryfallId: string, foil: string, condition: string, language: string, collectionId: number): CardsRow | null {
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
        collection_id: r.collection_id,
        foil: r.foil,
        condition: r.condition,
        language: r.language,
        quantity: r.quantity,
        price_usd: r.price_at_first_scan_usd,
        last_seen_at: r.last_seen_at,
        needs_review: r.needs_review === 1,
      }));
    },

    listCollections(): CollectionForRenderer[] {
      const rows = listCollectionsStmt.all();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        is_wishlist: r.is_wishlist === 1,
        sort_order: r.sort_order,
        count: r.count,
      }));
    },

    createCollection(name: string): number {
      const info = insertCollection.run(name, Date.now());
      return Number(info.lastInsertRowid);
    },

    renameCollection(id: number, name: string): void {
      renameCollectionStmt.run(name, id);
    },

    deleteCollection(id: number, mode: 'delete-cards' | 'move-cards', targetCollectionId?: number): void {
      const tx = db.transaction(() => {
        if (mode === 'move-cards' && targetCollectionId != null) {
          moveCardsToCollection.run(targetCollectionId, id);
        } else {
          deleteCardsByCollection.run(id);
        }
        deleteCollectionStmt.run(id);
      });
      tx();
    },

    close() {
      db.close();
    },
  };
}

export function defaultCataloguePath(userDataDir: string): string {
  return join(userDataDir, 'catalogue.db');
}
