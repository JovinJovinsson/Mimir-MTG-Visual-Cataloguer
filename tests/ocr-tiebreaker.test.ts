import { describe, it, expect } from 'vitest';
import { resolveWithOcr } from '../src/main/ocr-tiebreaker.js';
import type { OcrDecision } from '../src/main/ocr-tiebreaker.js';
import type { ReviewCandidate } from '../src/shared/types.js';
import type { AutocompleteHitDto } from '../src/shared/ipc.js';

function makeCandidate(name: string, scryfallId = name): ReviewCandidate {
  return {
    scryfallId,
    name,
    setCode: 'tst',
    setName: 'Test Set',
    collectorNumber: '1',
    priceUsd: null,
    hammingDistance: 5,
    artCropPath: null,
  };
}

function makeHit(name: string): AutocompleteHitDto {
  return {
    scryfall_id: name,
    name,
    set_code: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
  };
}

const noLookup = (): AutocompleteHitDto[] => [];

// ── Cycle 1: empty / blank ocrText ────────────────────────────────────────────

describe('resolveWithOcr — empty ocrText', () => {
  it('returns unknown for empty string', () => {
    const result = resolveWithOcr([], '', noLookup);
    expect(result.kind).toBe('unknown');
  });

  it('returns unknown for whitespace-only string', () => {
    const result = resolveWithOcr([makeCandidate('Lightning Bolt')], '   ', noLookup);
    expect(result.kind).toBe('unknown');
  });
});

// ── Cycle 2: exact match, single candidate ────────────────────────────────────

describe('resolveWithOcr — exact single match', () => {
  it('returns boosted-accept when exactly one candidate matches exactly', () => {
    const candidate = makeCandidate('Lightning Bolt');
    const result = resolveWithOcr([candidate], 'Lightning Bolt', noLookup);
    expect(result.kind).toBe('boosted-accept');
    if (result.kind !== 'boosted-accept') return;
    expect(result.candidate.scryfallId).toBe('Lightning Bolt');
  });
});

// ── Cycle 3: case-insensitive match ──────────────────────────────────────────

describe('resolveWithOcr — case-insensitive match', () => {
  it('matches regardless of case', () => {
    const candidate = makeCandidate('Lightning Bolt');
    const result = resolveWithOcr([candidate], 'lightning bolt', noLookup);
    expect(result.kind).toBe('boosted-accept');
  });

  it('accepts mixed case ocrText', () => {
    const candidate = makeCandidate('Lightning Bolt');
    const result = resolveWithOcr([candidate], 'LIGHTNING BOLT', noLookup);
    expect(result.kind).toBe('boosted-accept');
  });
});

// ── Cycle 4: fuzzy match (OCR typos) ─────────────────────────────────────────

describe('resolveWithOcr — fuzzy matching', () => {
  it('accepts minor OCR typo (one char substitution)', () => {
    const candidate = makeCandidate('Lightning Bolt');
    // "Llghtning Bolt" — 1 char changed out of 14 → well within threshold
    const result = resolveWithOcr([candidate], 'Llghtning Bolt', noLookup);
    expect(result.kind).toBe('boosted-accept');
  });

  it('rejects heavily corrupted text (many errors)', () => {
    const candidate = makeCandidate('Lightning Bolt');
    // "XXXXXXXXXXXXXXX" is completely different
    const result = resolveWithOcr([candidate], 'XXXXXXXXXXXXXXX', noLookup);
    // Should not accept this
    expect(result.kind).not.toBe('boosted-accept');
  });
});

// ── Cycle 5: multiple candidates match → ambiguous ───────────────────────────

describe('resolveWithOcr — multiple matches → ambiguous', () => {
  it('returns ambiguous when two candidates match', () => {
    const c1 = makeCandidate('Lightning Bolt', 'id-1');
    const c2 = makeCandidate('Lightning Bolt', 'id-2');
    const result = resolveWithOcr([c1, c2], 'Lightning Bolt', noLookup);
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.candidates).toHaveLength(2);
  });

  it('only includes matching candidates in ambiguous result', () => {
    const c1 = makeCandidate('Lightning Bolt', 'id-1');
    const c2 = makeCandidate('Lightning Bolt', 'id-2');
    const c3 = makeCandidate('Dark Ritual', 'id-3');
    const result = resolveWithOcr([c1, c2, c3], 'Lightning Bolt', noLookup);
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.candidates.map((c) => c.scryfallId)).toEqual(['id-1', 'id-2']);
  });
});

// ── Cycle 6: no match, lookup returns results → resolve-by-name ──────────────

describe('resolveWithOcr — no pHash match, lookup succeeds', () => {
  it('returns resolve-by-name when no topN candidate matches but name is in index', () => {
    const candidate = makeCandidate('Dark Ritual');
    const hit = makeHit('Lightning Bolt');
    const result = resolveWithOcr([candidate], 'Lightning Bolt', () => [hit]);
    expect(result.kind).toBe('resolve-by-name');
    if (result.kind !== 'resolve-by-name') return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.name).toBe('Lightning Bolt');
  });

  it('passes the ocrText directly to the lookup function', () => {
    let queriedName = '';
    resolveWithOcr([], 'Giant Growth', (name) => {
      queriedName = name;
      return [makeHit('Giant Growth')];
    });
    expect(queriedName).toBe('Giant Growth');
  });
});

// ── Cycle 7: no match, lookup also empty → unknown ───────────────────────────

describe('resolveWithOcr — no match anywhere → unknown', () => {
  it('returns unknown when no candidates match and lookup returns empty', () => {
    const candidate = makeCandidate('Dark Ritual');
    const result = resolveWithOcr([candidate], 'Completely Unknown Xyzzy', noLookup);
    expect(result.kind).toBe('unknown');
  });

  it('returns unknown when topN is empty and lookup returns empty', () => {
    const result = resolveWithOcr([], 'Something', noLookup);
    expect(result.kind).toBe('unknown');
  });
});

// ── Cycle 8: resolve-by-name returns all lookup hits ─────────────────────────

describe('resolveWithOcr — resolve-by-name carries all hits', () => {
  it('includes all candidates returned by lookup', () => {
    const hits = [makeHit('Lightning Bolt'), makeHit('Lightning Bolt')];
    const result = resolveWithOcr([], 'Lightning Bolt', () => hits);
    expect(result.kind).toBe('resolve-by-name');
    if (result.kind !== 'resolve-by-name') return;
    expect(result.candidates).toHaveLength(2);
  });
});
