import { describe, it, expect } from 'vitest';
import { planRecognitionCatalogueAction } from '../src/main/recognition-planner.js';
import type { RecognitionResult } from '../src/main/recognition-pipeline.js';
import type { CardsRow } from '../src/shared/types.js';

const INBOX_ID = 1;
const NOW = 2_000_000;

const matchedResult: RecognitionResult = {
  kind: 'matched',
  phash: 'abcd1234abcd1234',
  confidenceScore: 0.9,
  match: {
    scryfallId: 'sf-abc',
    name: 'Fireball',
    setCode: 'm10',
    setName: 'Magic 2010',
    collectorNumber: '99',
    priceUsd: 3.50,
    hammingDistance: 4,
  },
};

const noMatchResult: RecognitionResult = {
  kind: 'no-match',
  phash: '0000000000000000',
  confidenceScore: 0.1,
};

const errorResult: RecognitionResult = { kind: 'error' };

const existingRow: CardsRow = {
  id: 7,
  scryfall_id: 'sf-abc',
  name: 'Fireball',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '99',
  collection_id: INBOX_ID,
  foil: 'normal',
  condition: 'NM',
  language: 'EN',
  quantity: 2,
  price_at_first_scan_usd: 3.50,
  notes: null,
  needs_review: 0,
  review_reasons: null,
  first_seen_at: 1_000_000,
  last_seen_at: 1_500_000,
};

describe('planRecognitionCatalogueAction — matched, no existing row', () => {
  it('returns insert action with matched card data', () => {
    const action = planRecognitionCatalogueAction(null, matchedResult, INBOX_ID, NOW);
    expect(action.kind).toBe('insert');
    if (action.kind !== 'insert') return;
    expect(action.row.scryfall_id).toBe('sf-abc');
    expect(action.row.name).toBe('Fireball');
    expect(action.row.set_code).toBe('m10');
    expect(action.row.collector_number).toBe('99');
    expect(action.row.collection_id).toBe(INBOX_ID);
    expect(action.row.quantity).toBe(1);
    expect(action.row.price_at_first_scan_usd).toBe(3.50);
    expect(action.row.first_seen_at).toBe(NOW);
    expect(action.row.last_seen_at).toBe(NOW);
  });

  it('defaults to normal foil, NM condition, EN language', () => {
    const action = planRecognitionCatalogueAction(null, matchedResult, INBOX_ID, NOW);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.foil).toBe('normal');
    expect(action.row.condition).toBe('NM');
    expect(action.row.language).toBe('EN');
  });

  it('tolerates null price in match', () => {
    const noPriceResult: RecognitionResult = {
      ...matchedResult,
      match: { ...matchedResult.match, priceUsd: null },
    };
    const action = planRecognitionCatalogueAction(null, noPriceResult, INBOX_ID, NOW);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.price_at_first_scan_usd).toBeNull();
  });
});

describe('planRecognitionCatalogueAction — matched, existing row (dedup hit)', () => {
  it('returns bump action when existing row matches dedup key', () => {
    const action = planRecognitionCatalogueAction(existingRow, matchedResult, INBOX_ID, NOW);
    expect(action.kind).toBe('bump');
    if (action.kind !== 'bump') return;
    expect(action.cardId).toBe(7);
    expect(action.newQuantity).toBe(3);
    expect(action.lastSeenAt).toBe(NOW);
  });
});

describe('planRecognitionCatalogueAction — no-match', () => {
  it('returns skip with reason no-match', () => {
    const action = planRecognitionCatalogueAction(null, noMatchResult, INBOX_ID, NOW);
    expect(action.kind).toBe('skip');
    if (action.kind !== 'skip') return;
    expect(action.reason).toBe('no-match');
  });

  it('returns skip even with an existing row', () => {
    const action = planRecognitionCatalogueAction(existingRow, noMatchResult, INBOX_ID, NOW);
    expect(action.kind).toBe('skip');
  });
});

describe('planRecognitionCatalogueAction — error', () => {
  it('returns skip with reason error', () => {
    const action = planRecognitionCatalogueAction(null, errorResult, INBOX_ID, NOW);
    expect(action.kind).toBe('skip');
    if (action.kind !== 'skip') return;
    expect(action.reason).toBe('error');
  });
});

describe('planRecognitionCatalogueAction — scanModePreset placeholder', () => {
  it('accepts null scanModePreset without affecting outcome', () => {
    const action = planRecognitionCatalogueAction(null, matchedResult, INBOX_ID, NOW, null);
    expect(action.kind).toBe('insert');
  });
});
