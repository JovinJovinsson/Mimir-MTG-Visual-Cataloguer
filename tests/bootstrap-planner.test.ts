import { describe, it, expect } from 'vitest';
import { planScryfallBootstrap, planBulkIngest } from '../src/main/scryfall-bootstrap.js';
import type { IndexState, ScryfallBulkCard } from '../src/main/scryfall-bootstrap.js';

const emptyState: IndexState = {
  hasIndex: true,
  cardCount: 0,
  setCount: 0,
  bulkDataLastFetchedAt: null,
};

const populatedState: IndexState = {
  hasIndex: true,
  cardCount: 100,
  setCount: 5,
  bulkDataLastFetchedAt: 1_700_000_000,
};

describe('planScryfallBootstrap — selected', () => {
  it('returns fetch-bulk with allowedSets for an empty index', () => {
    const plan = planScryfallBootstrap({ kind: 'selected', setCodes: ['dmu', 'bro'] }, emptyState);
    expect(plan.kind).toBe('fetch-bulk');
    if (plan.kind === 'fetch-bulk') {
      expect(plan.allowedSets).toEqual(['dmu', 'bro']);
    }
  });

  it('skips when the index is already populated (selected)', () => {
    const plan = planScryfallBootstrap({ kind: 'selected', setCodes: ['dmu'] }, populatedState);
    expect(plan.kind).toBe('skip');
  });

  it('includes all provided set codes in allowedSets', () => {
    const setCodes = ['neo', 'snc', 'dmu', 'bro', 'one', 'mat'];
    const plan = planScryfallBootstrap({ kind: 'selected', setCodes }, emptyState);
    expect(plan.kind).toBe('fetch-bulk');
    if (plan.kind === 'fetch-bulk') {
      expect(plan.allowedSets).toEqual(setCodes);
    }
  });
});

describe('planScryfallBootstrap — standard', () => {
  it('returns fetch-bulk with standardSetCodes as allowedSets for an empty index', () => {
    const standardSetCodes = ['one', 'mat', 'mom', 'woe'];
    const plan = planScryfallBootstrap({ kind: 'standard', standardSetCodes }, emptyState);
    expect(plan.kind).toBe('fetch-bulk');
    if (plan.kind === 'fetch-bulk') {
      expect(plan.allowedSets).toEqual(standardSetCodes);
    }
  });

  it('skips when the index is already populated (standard)', () => {
    const plan = planScryfallBootstrap(
      { kind: 'standard', standardSetCodes: ['one'] },
      populatedState,
    );
    expect(plan.kind).toBe('skip');
  });

  it('handles empty standardSetCodes array gracefully', () => {
    const plan = planScryfallBootstrap({ kind: 'standard', standardSetCodes: [] }, emptyState);
    expect(plan.kind).toBe('fetch-bulk');
    if (plan.kind === 'fetch-bulk') {
      expect(plan.allowedSets).toEqual([]);
    }
  });
});

describe('planScryfallBootstrap — full', () => {
  it('returns fetch-bulk with null allowedSets for full selection', () => {
    const plan = planScryfallBootstrap('full', emptyState);
    expect(plan.kind).toBe('fetch-bulk');
    if (plan.kind === 'fetch-bulk') {
      expect(plan.allowedSets).toBeNull();
    }
  });

  it('skips when the index is populated for full selection', () => {
    const plan = planScryfallBootstrap('full', populatedState);
    expect(plan.kind).toBe('skip');
  });
});

// ── planBulkIngest allowedSets filtering ──────────────────────────────────────

const cards: ScryfallBulkCard[] = [
  { id: 'a1', name: 'Alpha', set: 'one', set_name: 'ONE', collector_number: '1' },
  { id: 'b1', name: 'Beta',  set: 'one', set_name: 'ONE', collector_number: '2' },
  { id: 'c1', name: 'Gamma', set: 'mat', set_name: 'MAT', collector_number: '1' },
  { id: 'd1', name: 'Delta', set: 'dmu', set_name: 'DMU', collector_number: '1' },
];

describe('planBulkIngest — allowedSets', () => {
  it('includes all cards when allowedSets is null', () => {
    const batches = planBulkIngest(cards, { allowedSets: null });
    const total = batches.reduce((s, b) => s + b.cards.length, 0);
    expect(total).toBe(4);
  });

  it('filters to only allowed sets', () => {
    const batches = planBulkIngest(cards, { allowedSets: ['one', 'mat'] });
    const total = batches.reduce((s, b) => s + b.cards.length, 0);
    expect(total).toBe(3);
    const setCodes = batches.flatMap((b) => b.cards.map((c) => c.set_code));
    expect(setCodes).not.toContain('dmu');
  });

  it('produces empty card list when no cards match allowed sets', () => {
    const batches = planBulkIngest(cards, { allowedSets: ['xyz'] });
    const total = batches.reduce((s, b) => s + b.cards.length, 0);
    expect(total).toBe(0);
  });

  it('still includes set rows for cards that match', () => {
    const batches = planBulkIngest(cards, { allowedSets: ['mat'] });
    const sets = batches.flatMap((b) => b.sets);
    const setCodes = sets.map((s) => s.code);
    expect(setCodes).toContain('mat');
    expect(setCodes).not.toContain('one');
    expect(setCodes).not.toContain('dmu');
  });
});
