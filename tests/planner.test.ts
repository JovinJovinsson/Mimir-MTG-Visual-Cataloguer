import { describe, it, expect } from 'vitest';
import { planCatalogueAddition } from '../src/main/planner.js';
import type { AddCardInput, CardsRow } from '../src/shared/types.js';

const baseInput: AddCardInput = {
  scryfall_id: 'sf-1',
  name: 'Lightning Bolt',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
  collection_id: 1,
  foil: 'normal',
  condition: 'NM',
  language: 'EN',
  price_usd: 1.23,
  now: 1_000_000,
};

const baseExisting: CardsRow = {
  id: 42,
  scryfall_id: 'sf-1',
  name: 'Lightning Bolt',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
  collection_id: 1,
  foil: 'normal',
  condition: 'NM',
  language: 'EN',
  quantity: 3,
  price_at_first_scan_usd: 1.23,
  notes: null,
  needs_review: 0,
  review_reasons: null,
  first_seen_at: 900_000,
  last_seen_at: 950_000,
};

describe('planCatalogueAddition', () => {
  it('returns insert when no existing row', () => {
    const action = planCatalogueAddition(null, baseInput);
    expect(action.kind).toBe('insert');
    if (action.kind !== 'insert') return;
    expect(action.row.scryfall_id).toBe('sf-1');
    expect(action.row.quantity).toBe(1);
    expect(action.row.first_seen_at).toBe(1_000_000);
    expect(action.row.last_seen_at).toBe(1_000_000);
    expect(action.row.price_at_first_scan_usd).toBe(1.23);
    expect(action.row.collection_id).toBe(1);
  });

  it('returns bump when existing row matches dedup key', () => {
    const action = planCatalogueAddition(baseExisting, baseInput);
    expect(action).toEqual({
      kind: 'bump',
      cardId: 42,
      newQuantity: 4,
      lastSeenAt: 1_000_000,
    });
  });

  it('returns insert when existing row differs by foil (dedup miss)', () => {
    const action = planCatalogueAddition(baseExisting, { ...baseInput, foil: 'foil' });
    expect(action.kind).toBe('insert');
  });

  it('returns insert when existing row differs by collection_id (dedup miss)', () => {
    const action = planCatalogueAddition(baseExisting, { ...baseInput, collection_id: 2 });
    expect(action.kind).toBe('insert');
  });

  it('returns insert when existing row differs by condition (dedup miss)', () => {
    const action = planCatalogueAddition(baseExisting, { ...baseInput, condition: 'LP' });
    expect(action.kind).toBe('insert');
  });

  it('returns insert when existing row differs by language (dedup miss)', () => {
    const action = planCatalogueAddition(baseExisting, { ...baseInput, language: 'JA' });
    expect(action.kind).toBe('insert');
  });

  it('throws when existing row differs by scryfall_id (caller error)', () => {
    const mismatched: CardsRow = { ...baseExisting, scryfall_id: 'sf-other' };
    expect(() => planCatalogueAddition(mismatched, baseInput)).toThrow(/scryfall_id/);
  });

  it('inserted row carries through name/set/collector metadata', () => {
    const action = planCatalogueAddition(null, baseInput);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.name).toBe('Lightning Bolt');
    expect(action.row.set_code).toBe('m10');
    expect(action.row.set_name).toBe('Magic 2010');
    expect(action.row.collector_number).toBe('146');
    expect(action.row.needs_review).toBe(0);
  });

  it('inserted row tolerates null price', () => {
    const action = planCatalogueAddition(null, { ...baseInput, price_usd: null });
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.price_at_first_scan_usd).toBeNull();
  });
});
