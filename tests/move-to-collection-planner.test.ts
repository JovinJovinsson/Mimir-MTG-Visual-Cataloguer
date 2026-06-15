import { describe, it, expect } from 'vitest';
import { planMoveToCollection } from '../src/main/move-to-collection-planner.js';
import type { CardsRow } from '../src/shared/types.js';

const baseRow: CardsRow = {
  id: 10,
  scryfall_id: 'sf-1',
  name: 'Lightning Bolt',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
  collection_id: 1,
  foil: 'normal',
  condition: 'NM',
  language: 'EN',
  quantity: 2,
  price_at_first_scan_usd: 1.23,
  notes: null,
  needs_review: 0,
  review_reasons: null,
  first_seen_at: 900_000,
  last_seen_at: 950_000,
};

const destRow: CardsRow = {
  ...baseRow,
  id: 20,
  collection_id: 2,
  quantity: 3,
  last_seen_at: 980_000,
};

describe('planMoveToCollection', () => {
  it('returns empty array when source and destination are the same collection', () => {
    const actions = planMoveToCollection(baseRow, 1, null);
    expect(actions).toEqual([]);
  });

  it('returns update-collection when no existing row in destination', () => {
    const actions = planMoveToCollection(baseRow, 2, null);
    expect(actions).toEqual([
      { kind: 'update-collection', cardId: 10, collectionId: 2 },
    ]);
  });

  it('merges quantities and deletes source when existing row found in destination', () => {
    const actions = planMoveToCollection(baseRow, 2, destRow);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      kind: 'bump',
      cardId: 20,
      newQuantity: 5,
      lastSeenAt: 980_000,
    });
    expect(actions[1]).toEqual({ kind: 'delete-card', cardId: 10 });
  });

  it('uses max of last_seen_at when merging', () => {
    const newerSource = { ...baseRow, last_seen_at: 999_000 };
    const actions = planMoveToCollection(newerSource, 2, destRow);
    const bump = actions[0];
    if (bump.kind !== 'bump') throw new Error('expected bump');
    expect(bump.lastSeenAt).toBe(999_000);
  });

  it('merged quantity sums source and destination quantities', () => {
    const source = { ...baseRow, quantity: 4 };
    const dest = { ...destRow, quantity: 7 };
    const actions = planMoveToCollection(source, 2, dest);
    const bump = actions[0];
    if (bump.kind !== 'bump') throw new Error('expected bump');
    expect(bump.newQuantity).toBe(11);
  });
});
