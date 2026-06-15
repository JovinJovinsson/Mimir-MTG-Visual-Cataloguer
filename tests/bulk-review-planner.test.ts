import { describe, it, expect } from 'vitest';
import { planBulkReviewAction } from '../src/main/bulk-review-planner.js';
import type { BulkReviewItemInput, BulkAction } from '../src/main/bulk-review-planner.js';
import type { ReviewItemForResolver } from '../src/main/review-resolver.js';
import type { CardsRow } from '../src/shared/types.js';

const INBOX_ID = 1;
const NOW = 5_000_000;

const candidateM10 = {
  scryfallId: 'sf-m10-bolt',
  name: 'Lightning Bolt',
  setCode: 'm10',
  setName: 'Magic 2010',
  collectorNumber: '146',
  priceUsd: 1.5,
  hammingDistance: 3,
  artCropPath: '/crops/bolt-m10.jpg',
};

const candidateLEA = {
  scryfallId: 'sf-lea-bolt',
  name: 'Lightning Bolt',
  setCode: 'lea',
  setName: 'Limited Edition Alpha',
  collectorNumber: '161',
  priceUsd: 800.0,
  hammingDistance: 8,
  artCropPath: null,
};

const candidateM11 = {
  scryfallId: 'sf-m11-shock',
  name: 'Shock',
  setCode: 'm11',
  setName: 'Magic 2011',
  collectorNumber: '152',
  priceUsd: 0.25,
  hammingDistance: 5,
  artCropPath: null,
};

const item1: ReviewItemForResolver = {
  id: 10,
  scanId: 1,
  candidates: [candidateM10, candidateLEA],
};

const item2: ReviewItemForResolver = {
  id: 20,
  scanId: 2,
  candidates: [candidateM10, candidateLEA],
};

const itemDifferentSet: ReviewItemForResolver = {
  id: 30,
  scanId: 3,
  candidates: [candidateM11, candidateLEA],
};

const itemNoScan: ReviewItemForResolver = {
  id: 40,
  scanId: null,
  candidates: [candidateM10],
};

function makeInput(item: ReviewItemForResolver, existingCard: CardsRow | null = null): BulkReviewItemInput {
  return { item, existingCard };
}

// ── dismiss-all ───────────────────────────────────────────────────────────────

describe('planBulkReviewAction — dismiss-all', () => {
  const action: BulkAction = { kind: 'dismiss-all' };

  it('returns empty array for no inputs', () => {
    const result = planBulkReviewAction([], action, INBOX_ID, NOW);
    expect(result).toHaveLength(0);
  });

  it('emits delete-scan and dismiss-review-queue for each item', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(item2)], action, INBOX_ID, NOW);
    const deletes = result.filter((a) => a.kind === 'delete-scan');
    const dismisses = result.filter((a) => a.kind === 'dismiss-review-queue');
    expect(deletes).toHaveLength(2);
    expect(dismisses).toHaveLength(2);
  });

  it('does not emit delete-scan when scanId is null', () => {
    const result = planBulkReviewAction([makeInput(itemNoScan)], action, INBOX_ID, NOW);
    expect(result.some((a) => a.kind === 'delete-scan')).toBe(false);
    expect(result.some((a) => a.kind === 'dismiss-review-queue')).toBe(true);
  });

  it('references the correct scanIds and reviewIds', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(item2)], action, INBOX_ID, NOW);
    const deletes = result.filter((a) => a.kind === 'delete-scan');
    const dismisses = result.filter((a) => a.kind === 'dismiss-review-queue');
    expect(deletes.map((a) => (a as { kind: 'delete-scan'; scanId: number }).scanId)).toEqual([1, 2]);
    expect(dismisses.map((a) => (a as { kind: 'dismiss-review-queue'; reviewId: number }).reviewId)).toEqual([10, 20]);
  });

  it('does not emit any card insert or bump actions', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(item2)], action, INBOX_ID, NOW);
    expect(result.some((a) => a.kind === 'insert')).toBe(false);
    expect(result.some((a) => a.kind === 'bump')).toBe(false);
  });
});

// ── confirm-all-foil ─────────────────────────────────────────────────────────

describe('planBulkReviewAction — confirm-all-foil', () => {
  const action: BulkAction = { kind: 'confirm-all-foil' };

  it('returns empty array for no inputs', () => {
    const result = planBulkReviewAction([], action, INBOX_ID, NOW);
    expect(result).toHaveLength(0);
  });

  it('emits insert with foil=foil for each item (top candidate)', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(item2)], action, INBOX_ID, NOW);
    const inserts = result.filter((a) => a.kind === 'insert');
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      if (insert.kind !== 'insert') continue;
      expect(insert.row.foil).toBe('foil');
      expect(insert.row.scryfall_id).toBe('sf-m10-bolt');
    }
  });

  it('emits resolve-review-queue for each item', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(item2)], action, INBOX_ID, NOW);
    const resolves = result.filter((a) => a.kind === 'resolve-review-queue');
    expect(resolves).toHaveLength(2);
    expect(resolves.map((a) => (a as { kind: 'resolve-review-queue'; reviewId: number }).reviewId)).toEqual([10, 20]);
  });

  it('emits update-scan-card for items that have a scanId', () => {
    const result = planBulkReviewAction([makeInput(item1)], action, INBOX_ID, NOW);
    const updates = result.filter((a) => a.kind === 'update-scan-card');
    expect(updates).toHaveLength(1);
    if (updates[0]?.kind !== 'update-scan-card') return;
    expect(updates[0].scanId).toBe(1);
  });

  it('skips update-scan-card when scanId is null', () => {
    const result = planBulkReviewAction([makeInput(itemNoScan)], action, INBOX_ID, NOW);
    expect(result.some((a) => a.kind === 'update-scan-card')).toBe(false);
  });

  it('emits a bump instead of insert when existingCard matches the foil key', () => {
    const existingFoilCard: CardsRow = {
      id: 99,
      scryfall_id: 'sf-m10-bolt',
      name: 'Lightning Bolt',
      set_code: 'm10',
      set_name: 'Magic 2010',
      collector_number: '146',
      collection_id: INBOX_ID,
      foil: 'foil',
      condition: 'NM',
      language: 'EN',
      quantity: 2,
      price_at_first_scan_usd: 1.5,
      notes: null,
      needs_review: 0,
      review_reasons: null,
      first_seen_at: 1_000_000,
      last_seen_at: 2_000_000,
    };
    const result = planBulkReviewAction([makeInput(item1, existingFoilCard)], action, INBOX_ID, NOW);
    const bumps = result.filter((a) => a.kind === 'bump');
    expect(bumps).toHaveLength(1);
    if (bumps[0]?.kind !== 'bump') return;
    expect(bumps[0].cardId).toBe(99);
    expect(bumps[0].newQuantity).toBe(3);
  });

  it('uses inboxCollectionId when existingCard is null', () => {
    const result = planBulkReviewAction([makeInput(item1)], action, INBOX_ID, NOW);
    const inserts = result.filter((a) => a.kind === 'insert');
    if (inserts[0]?.kind !== 'insert') return;
    expect(inserts[0].row.collection_id).toBe(INBOX_ID);
  });

  it('uses existingCard collection_id when present', () => {
    const existingInOtherCollection: CardsRow = {
      id: 55,
      scryfall_id: 'sf-m10-bolt',
      name: 'Lightning Bolt',
      set_code: 'm10',
      set_name: 'Magic 2010',
      collector_number: '146',
      collection_id: 7,
      foil: 'normal',
      condition: 'NM',
      language: 'EN',
      quantity: 1,
      price_at_first_scan_usd: 1.5,
      notes: null,
      needs_review: 0,
      review_reasons: null,
      first_seen_at: 1_000_000,
      last_seen_at: 2_000_000,
    };
    const result = planBulkReviewAction([makeInput(item1, existingInOtherCollection)], action, INBOX_ID, NOW);
    const inserts = result.filter((a) => a.kind === 'insert');
    if (inserts[0]?.kind !== 'insert') return;
    expect(inserts[0].row.collection_id).toBe(7);
  });

  it('skips items with no candidates', () => {
    const itemNoCandidates: ReviewItemForResolver = { id: 50, scanId: 5, candidates: [] };
    const result = planBulkReviewAction([makeInput(itemNoCandidates)], action, INBOX_ID, NOW);
    expect(result.some((a) => a.kind === 'insert')).toBe(false);
    expect(result.some((a) => a.kind === 'resolve-review-queue')).toBe(false);
  });
});

// ── mark-all-as-set ───────────────────────────────────────────────────────────

describe('planBulkReviewAction — mark-all-as-set', () => {
  const action: BulkAction = { kind: 'mark-all-as-set', setCode: 'm10' };

  it('returns empty array for no inputs', () => {
    const result = planBulkReviewAction([], action, INBOX_ID, NOW);
    expect(result).toHaveLength(0);
  });

  it('confirms each item to its top-1 in-set candidate', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(item2)], action, INBOX_ID, NOW);
    const inserts = result.filter((a) => a.kind === 'insert');
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      if (insert.kind !== 'insert') continue;
      expect(insert.row.scryfall_id).toBe('sf-m10-bolt');
      expect(insert.row.set_code).toBe('m10');
    }
  });

  it('emits resolve-review-queue for each matched item', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(item2)], action, INBOX_ID, NOW);
    const resolves = result.filter((a) => a.kind === 'resolve-review-queue');
    expect(resolves).toHaveLength(2);
  });

  it('skips items with no candidate in the target set', () => {
    const result = planBulkReviewAction([makeInput(item1), makeInput(itemDifferentSet)], action, INBOX_ID, NOW);
    const inserts = result.filter((a) => a.kind === 'insert');
    // item1 has m10 candidate, itemDifferentSet has m11 (no m10) → only item1 gets an insert
    expect(inserts).toHaveLength(1);
    if (inserts[0]?.kind !== 'insert') return;
    expect(inserts[0].row.scryfall_id).toBe('sf-m10-bolt');
  });

  it('uses foil=normal by default', () => {
    const result = planBulkReviewAction([makeInput(item1)], action, INBOX_ID, NOW);
    const inserts = result.filter((a) => a.kind === 'insert');
    if (inserts[0]?.kind !== 'insert') return;
    expect(inserts[0].row.foil).toBe('normal');
  });

  it('selects the best (lowest hamming) candidate in the given set, not just the first overall', () => {
    // Create item where LEA candidate comes first but m10 is the setCode match
    const itemLEAFirst: ReviewItemForResolver = {
      id: 60,
      scanId: 6,
      candidates: [candidateLEA, candidateM10],
    };
    const result = planBulkReviewAction([makeInput(itemLEAFirst)], action, INBOX_ID, NOW);
    const inserts = result.filter((a) => a.kind === 'insert');
    expect(inserts).toHaveLength(1);
    if (inserts[0]?.kind !== 'insert') return;
    expect(inserts[0].row.set_code).toBe('m10');
    expect(inserts[0].row.scryfall_id).toBe('sf-m10-bolt');
  });

  it('emits update-scan-card for items with a scanId', () => {
    const result = planBulkReviewAction([makeInput(item1)], action, INBOX_ID, NOW);
    expect(result.some((a) => a.kind === 'update-scan-card')).toBe(true);
  });
});
