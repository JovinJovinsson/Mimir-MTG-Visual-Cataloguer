import { describe, it, expect } from 'vitest';
import { resolveReviewItem } from '../src/main/review-resolver.js';
import type { ReviewItemForResolver, UserResolution } from '../src/main/review-resolver.js';
import type { CardsRow } from '../src/shared/types.js';

const INBOX_ID = 1;
const NOW = 3_000_000;

const candidate1 = {
  scryfallId: 'sf-aaa',
  name: 'Lightning Bolt',
  setCode: 'm10',
  setName: 'Magic 2010',
  collectorNumber: '146',
  priceUsd: 1.5,
  hammingDistance: 3,
  artCropPath: '/crops/sf-aaa.jpg',
};

const candidate2 = {
  scryfallId: 'sf-bbb',
  name: 'Lightning Bolt',
  setCode: 'lea',
  setName: 'Limited Edition Alpha',
  collectorNumber: '161',
  priceUsd: 800.0,
  hammingDistance: 8,
  artCropPath: null,
};

const reviewItem: ReviewItemForResolver = {
  id: 42,
  scanId: 7,
  candidates: [candidate1, candidate2],
};

const existingCard: CardsRow = {
  id: 99,
  scryfall_id: 'sf-aaa',
  name: 'Lightning Bolt',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
  collection_id: INBOX_ID,
  foil: 'normal',
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

describe('resolveReviewItem — confirm, no existing card', () => {
  const resolution: UserResolution = { kind: 'confirm', scryfallId: 'sf-aaa' };

  it('returns an insert action for the selected candidate', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const insert = actions.find((a) => a.kind === 'insert');
    expect(insert).toBeDefined();
    if (insert?.kind !== 'insert') return;
    expect(insert.row.scryfall_id).toBe('sf-aaa');
    expect(insert.row.name).toBe('Lightning Bolt');
    expect(insert.row.set_code).toBe('m10');
    expect(insert.row.collector_number).toBe('146');
    expect(insert.row.collection_id).toBe(INBOX_ID);
    expect(insert.row.quantity).toBe(1);
    expect(insert.row.price_at_first_scan_usd).toBe(1.5);
    expect(insert.row.first_seen_at).toBe(NOW);
    expect(insert.row.last_seen_at).toBe(NOW);
  });

  it('returns an update-scan-card action', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const upd = actions.find((a) => a.kind === 'update-scan-card');
    expect(upd).toBeDefined();
    if (upd?.kind !== 'update-scan-card') return;
    expect(upd.scanId).toBe(7);
  });

  it('returns a resolve-review-queue action', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const resolve = actions.find((a) => a.kind === 'resolve-review-queue');
    expect(resolve).toBeDefined();
    if (resolve?.kind !== 'resolve-review-queue') return;
    expect(resolve.reviewId).toBe(42);
    expect(resolve.scryfallId).toBe('sf-aaa');
  });

  it('defaults foil/condition/language', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const insert = actions.find((a) => a.kind === 'insert');
    if (insert?.kind !== 'insert') throw new Error('expected insert');
    expect(insert.row.foil).toBe('normal');
    expect(insert.row.condition).toBe('NM');
    expect(insert.row.language).toBe('EN');
  });
});

describe('resolveReviewItem — confirm, existing card (dedup hit)', () => {
  const resolution: UserResolution = { kind: 'confirm', scryfallId: 'sf-aaa' };

  it('returns a bump action instead of insert', () => {
    const actions = resolveReviewItem(reviewItem, resolution, existingCard, INBOX_ID, NOW);
    const bump = actions.find((a) => a.kind === 'bump');
    expect(bump).toBeDefined();
    if (bump?.kind !== 'bump') return;
    expect(bump.cardId).toBe(99);
    expect(bump.newQuantity).toBe(3);
    expect(bump.lastSeenAt).toBe(NOW);
  });

  it('still returns update-scan-card and resolve-review-queue', () => {
    const actions = resolveReviewItem(reviewItem, resolution, existingCard, INBOX_ID, NOW);
    expect(actions.some((a) => a.kind === 'update-scan-card')).toBe(true);
    expect(actions.some((a) => a.kind === 'resolve-review-queue')).toBe(true);
  });

  it('does not return an insert action', () => {
    const actions = resolveReviewItem(reviewItem, resolution, existingCard, INBOX_ID, NOW);
    expect(actions.some((a) => a.kind === 'insert')).toBe(false);
  });
});

describe('resolveReviewItem — confirm second candidate', () => {
  const resolution: UserResolution = { kind: 'confirm', scryfallId: 'sf-bbb' };

  it('uses the selected candidate data (not the first)', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const insert = actions.find((a) => a.kind === 'insert');
    if (insert?.kind !== 'insert') throw new Error('expected insert');
    expect(insert.row.scryfall_id).toBe('sf-bbb');
    expect(insert.row.set_code).toBe('lea');
    expect(insert.row.price_at_first_scan_usd).toBe(800.0);
  });
});

describe('resolveReviewItem — skip', () => {
  const resolution: UserResolution = { kind: 'skip' };

  it('returns only a skip-review-queue action', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('skip-review-queue');
  });

  it('references the correct reviewId', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const skip = actions[0];
    if (skip?.kind !== 'skip-review-queue') throw new Error('expected skip');
    expect(skip.reviewId).toBe(42);
  });
});

describe('resolveReviewItem — dismiss (with scanId)', () => {
  const resolution: UserResolution = { kind: 'dismiss' };

  it('returns a delete-scan action', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const del = actions.find((a) => a.kind === 'delete-scan');
    expect(del).toBeDefined();
    if (del?.kind !== 'delete-scan') return;
    expect(del.scanId).toBe(7);
  });

  it('returns a dismiss-review-queue action', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    const dismiss = actions.find((a) => a.kind === 'dismiss-review-queue');
    expect(dismiss).toBeDefined();
    if (dismiss?.kind !== 'dismiss-review-queue') return;
    expect(dismiss.reviewId).toBe(42);
  });

  it('does not return any card mutation actions', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    expect(actions.some((a) => a.kind === 'insert')).toBe(false);
    expect(actions.some((a) => a.kind === 'bump')).toBe(false);
  });
});

describe('resolveReviewItem — dismiss without scanId', () => {
  const itemWithoutScan: ReviewItemForResolver = { ...reviewItem, scanId: null };
  const resolution: UserResolution = { kind: 'dismiss' };

  it('omits the delete-scan action when scanId is null', () => {
    const actions = resolveReviewItem(itemWithoutScan, resolution, null, INBOX_ID, NOW);
    expect(actions.some((a) => a.kind === 'delete-scan')).toBe(false);
  });

  it('still returns the dismiss-review-queue action', () => {
    const actions = resolveReviewItem(itemWithoutScan, resolution, null, INBOX_ID, NOW);
    expect(actions.some((a) => a.kind === 'dismiss-review-queue')).toBe(true);
  });
});

describe('resolveReviewItem — confirm with unknown scryfallId', () => {
  const resolution: UserResolution = { kind: 'confirm', scryfallId: 'sf-unknown' };

  it('returns only a resolve-review-queue when candidate not found', () => {
    const actions = resolveReviewItem(reviewItem, resolution, null, INBOX_ID, NOW);
    expect(actions.some((a) => a.kind === 'insert')).toBe(false);
    expect(actions.some((a) => a.kind === 'resolve-review-queue')).toBe(true);
  });
});
