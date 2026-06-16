import { describe, it, expect } from 'vitest';
import {
  planBulkEdit,
  sortPersistenceReducer,
  type CardRowForEdit,
  type BulkEditInput,
  type SortPref,
  type SortByCollection,
} from '../src/main/catalogue-edit-planner.js';

// ── planBulkEdit ──────────────────────────────────────────────────────────────

const baseRow: CardRowForEdit = {
  id: 1,
  quantity: 2,
  collection_id: 10,
};

describe('planBulkEdit', () => {
  it('returns empty array for empty input', () => {
    const actions = planBulkEdit([baseRow], {});
    expect(actions).toEqual([]);
  });

  it('returns empty array for empty row list', () => {
    const actions = planBulkEdit([], { qty: 3 });
    expect(actions).toEqual([]);
  });

  it('emits update-qty for qty field', () => {
    const actions = planBulkEdit([baseRow], { qty: 5 });
    expect(actions).toEqual([{ kind: 'update-qty', cardId: 1, qty: 5 }]);
  });

  it('emits update-foil for foil field', () => {
    const actions = planBulkEdit([baseRow], { foil: 'foil' });
    expect(actions).toEqual([{ kind: 'update-foil', cardId: 1, foil: 'foil' }]);
  });

  it('emits update-condition for condition field', () => {
    const actions = planBulkEdit([baseRow], { condition: 'LP' });
    expect(actions).toEqual([{ kind: 'update-condition', cardId: 1, condition: 'LP' }]);
  });

  it('emits update-collection when collectionId differs from row', () => {
    const actions = planBulkEdit([baseRow], { collectionId: 20 });
    expect(actions).toEqual([{ kind: 'update-collection', cardId: 1, collectionId: 20 }]);
  });

  it('does NOT emit update-collection when collectionId matches existing', () => {
    const actions = planBulkEdit([baseRow], { collectionId: 10 });
    expect(actions).toEqual([]);
  });

  it('combines multiple field updates for a single row', () => {
    const actions = planBulkEdit([baseRow], { qty: 3, foil: 'etched', condition: 'NM' });
    expect(actions).toHaveLength(3);
    expect(actions).toContainEqual({ kind: 'update-qty', cardId: 1, qty: 3 });
    expect(actions).toContainEqual({ kind: 'update-foil', cardId: 1, foil: 'etched' });
    expect(actions).toContainEqual({ kind: 'update-condition', cardId: 1, condition: 'NM' });
  });

  it('emits actions for multiple rows', () => {
    const rows: CardRowForEdit[] = [
      { id: 1, quantity: 1, collection_id: 10 },
      { id: 2, quantity: 3, collection_id: 10 },
    ];
    const actions = planBulkEdit(rows, { qty: 5 });
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ kind: 'update-qty', cardId: 1, qty: 5 });
    expect(actions[1]).toEqual({ kind: 'update-qty', cardId: 2, qty: 5 });
  });

  it('skips collection update for rows already in the target collection, updates others', () => {
    const rows: CardRowForEdit[] = [
      { id: 1, quantity: 1, collection_id: 10 },
      { id: 2, quantity: 2, collection_id: 20 },
    ];
    const actions = planBulkEdit(rows, { collectionId: 10 });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: 'update-collection', cardId: 2, collectionId: 10 });
  });
});

// ── sortPersistenceReducer ────────────────────────────────────────────────────

const sort1: SortPref = { field: 'name', dir: 'asc' };
const sort2: SortPref = { field: 'last_seen_at', dir: 'desc' };

describe('sortPersistenceReducer', () => {
  it('adds a new entry for a collection', () => {
    const next = sortPersistenceReducer({}, 'all', sort1);
    expect(next).toEqual({ all: sort1 });
  });

  it('overwrites an existing entry', () => {
    const current: SortByCollection = { all: sort1 };
    const next = sortPersistenceReducer(current, 'all', sort2);
    expect(next['all']).toEqual(sort2);
  });

  it('does not mutate the original object', () => {
    const current: SortByCollection = { all: sort1 };
    sortPersistenceReducer(current, 'all', sort2);
    expect(current['all']).toEqual(sort1);
  });

  it('handles numeric collection IDs', () => {
    const next = sortPersistenceReducer({}, 5, sort1);
    expect(next[5]).toEqual(sort1);
  });

  it('preserves other collection entries when updating one', () => {
    const current: SortByCollection = { all: sort1, 5: sort2 };
    const next = sortPersistenceReducer(current, 'all', sort2);
    expect(next[5]).toEqual(sort2);
    expect(next['all']).toEqual(sort2);
  });
});
