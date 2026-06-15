import { describe, it, expect } from 'vitest';
import { planCatalogueAdditionWithInferences, type FieldInferences } from '../src/main/planner.js';
import type { ScanModePreset } from '../src/shared/types.js';

// Base input — collection_id and now will be supplied by individual tests
const baseInput = {
  scryfall_id: 'sf-1',
  name: 'Lightning Bolt',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
  collection_id: 1,
  now: 1_000_000,
};

// Low-confidence inferences — would normally trigger review flags
const lowConfidenceInferences: FieldInferences = {
  foil: { value: 'foil', confidence: 0.3 },
  language: { value: 'JA', confidence: 0.25 },
  price: { value: 2.5, confidence: 0.9 },
};

// Low-confidence foil only; language is high-confidence
const lowFoilOnlyInferences: FieldInferences = {
  foil: { value: 'foil', confidence: 0.3 },
  language: { value: 'EN', confidence: 0.92 },
  price: { value: 1.23, confidence: 0.95 },
};

const highConfidenceInferences: FieldInferences = {
  foil: { value: 'normal', confidence: 0.85 },
  language: { value: 'EN', confidence: 0.92 },
  price: { value: 1.23, confidence: 0.95 },
};

// ── Preset foil ───────────────────────────────────────────────────────────────

describe('planCatalogueAdditionWithInferences with preset', () => {
  it('explicit foil preset overrides low-confidence inference and suppresses review flag', () => {
    const preset: ScanModePreset = {
      foil: 'foil',
      condition: 'auto',
      language: 'auto',
      collectionId: 'inbox',
    };
    // Use low-foil-only inferences so only foil would normally flag
    const action = planCatalogueAdditionWithInferences(null, baseInput, lowFoilOnlyInferences, undefined, preset);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.foil).toBe('foil');
    expect(action.row.needs_review).toBe(0);
    expect(action.row.review_reasons).toBeNull();
  });

  it('explicit foil preset still allows language flag when language is auto', () => {
    const preset: ScanModePreset = {
      foil: 'normal',
      condition: 'auto',
      language: 'auto',
      collectionId: 'inbox',
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, lowConfidenceInferences, undefined, preset);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.foil).toBe('normal');
    expect(action.row.needs_review).toBe(1);
    const reasons = JSON.parse(action.row.review_reasons!) as string[];
    expect(reasons).toContain('low_confidence_field:language');
    expect(reasons).not.toContain('low_confidence_field:foil');
  });

  it('explicit language preset suppresses language review flag', () => {
    const preset: ScanModePreset = {
      foil: 'auto',
      condition: 'auto',
      language: 'JA',
      collectionId: 'inbox',
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, lowConfidenceInferences, undefined, preset);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.language).toBe('JA');
    const reasons = JSON.parse(action.row.review_reasons ?? '[]') as string[];
    expect(reasons).not.toContain('low_confidence_field:language');
  });

  it('both foil and language preset suppresses all review flags even with low-confidence inferences', () => {
    const preset: ScanModePreset = {
      foil: 'etched',
      condition: 'LP',
      language: 'DE',
      collectionId: 'inbox',
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, lowConfidenceInferences, undefined, preset);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.foil).toBe('etched');
    expect(action.row.condition).toBe('LP');
    expect(action.row.language).toBe('DE');
    expect(action.row.needs_review).toBe(0);
    expect(action.row.review_reasons).toBeNull();
  });

  it('condition preset uses preset value instead of NM default', () => {
    const preset: ScanModePreset = {
      foil: 'auto',
      condition: 'HP',
      language: 'auto',
      collectionId: 'inbox',
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, highConfidenceInferences, undefined, preset);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.condition).toBe('HP');
  });

  it('auto preset falls back to inference and raises review flag on low confidence', () => {
    const preset: ScanModePreset = {
      foil: 'auto',
      condition: 'auto',
      language: 'auto',
      collectionId: 'inbox',
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, lowConfidenceInferences, undefined, preset);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.needs_review).toBe(1);
    const reasons = JSON.parse(action.row.review_reasons!) as string[];
    expect(reasons).toContain('low_confidence_field:foil');
    expect(reasons).toContain('low_confidence_field:language');
  });

  it('no preset (undefined) behaves identically to all-auto preset', () => {
    const actionNoPreset = planCatalogueAdditionWithInferences(null, baseInput, lowConfidenceInferences);
    const actionAutoPreset = planCatalogueAdditionWithInferences(null, baseInput, lowConfidenceInferences, undefined, {
      foil: 'auto',
      condition: 'auto',
      language: 'auto',
      collectionId: 'inbox',
    });
    expect(actionNoPreset).toEqual(actionAutoPreset);
  });

  it('bump is returned when preset fields match existing dedup key', () => {
    const existing = {
      id: 42,
      scryfall_id: 'sf-1',
      name: 'Lightning Bolt',
      set_code: 'm10',
      set_name: 'Magic 2010',
      collector_number: '146',
      collection_id: 1,
      foil: 'foil' as const,
      condition: 'LP' as const,
      language: 'DE',
      quantity: 2,
      price_at_first_scan_usd: 2.5,
      notes: null,
      needs_review: 0 as const,
      review_reasons: null,
      first_seen_at: 900_000,
      last_seen_at: 950_000,
    };
    const preset: ScanModePreset = {
      foil: 'foil',
      condition: 'LP',
      language: 'DE',
      collectionId: 'inbox',
    };
    const action = planCatalogueAdditionWithInferences(existing, baseInput, lowConfidenceInferences, undefined, preset);
    expect(action.kind).toBe('bump');
  });
});
