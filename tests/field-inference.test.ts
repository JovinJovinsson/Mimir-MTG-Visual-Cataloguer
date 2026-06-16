import { describe, it, expect } from 'vitest';
import {
  classifyInference,
  inferFoil,
  inferLanguage,
  inferPrice,
  DEFAULT_THRESHOLDS,
  type InferenceResult,
  type EtchedContext,
} from '../src/main/field-inference.js';
import { planCatalogueAdditionWithInferences, type FieldInferences } from '../src/main/planner.js';
import type { CardsRow } from '../src/shared/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function solidRgba(r: number, g: number, b: number, count = 100): Uint8Array {
  const arr = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    arr[i * 4] = r;
    arr[i * 4 + 1] = g;
    arr[i * 4 + 2] = b;
    arr[i * 4 + 3] = 255;
  }
  return arr;
}

// ── classifyInference ─────────────────────────────────────────────────────────

describe('classifyInference', () => {
  it('returns accept when confidence >= acceptSilently', () => {
    const result: InferenceResult<string> = { value: 'EN', confidence: 0.8 };
    expect(classifyInference(result)).toBe('accept');
  });

  it('returns accept-flag when confidence is between thresholds', () => {
    const result: InferenceResult<string> = { value: 'EN', confidence: 0.5 };
    expect(classifyInference(result)).toBe('accept-flag');
  });

  it('returns blank-flag when confidence < acceptAndFlag', () => {
    const result: InferenceResult<string> = { value: 'EN', confidence: 0.2 };
    expect(classifyInference(result)).toBe('blank-flag');
  });

  it('returns accept exactly at acceptSilently boundary', () => {
    const result: InferenceResult<string> = { value: 'EN', confidence: 0.75 };
    expect(classifyInference(result)).toBe('accept');
  });

  it('returns accept-flag exactly at acceptAndFlag boundary', () => {
    const result: InferenceResult<string> = { value: 'EN', confidence: 0.4 };
    expect(classifyInference(result)).toBe('accept-flag');
  });

  it('returns blank-flag just below acceptAndFlag', () => {
    const result: InferenceResult<string> = { value: 'EN', confidence: 0.39 };
    expect(classifyInference(result)).toBe('blank-flag');
  });

  it('respects custom thresholds', () => {
    const result: InferenceResult<string> = { value: 'EN', confidence: 0.6 };
    expect(classifyInference(result, { acceptSilently: 0.9, acceptAndFlag: 0.5 })).toBe('accept-flag');
    expect(classifyInference(result, { acceptSilently: 0.5, acceptAndFlag: 0.3 })).toBe('accept');
  });
});

// ── inferFoil ─────────────────────────────────────────────────────────────────

describe('inferFoil', () => {
  it('returns normal with high confidence for near-greyscale image', () => {
    // Near-greyscale = very low saturation
    const rgba = solidRgba(50, 50, 52, 1000); // near-greyscale
    const result = inferFoil(rgba, 100, 10);
    expect(result.value).toBe('normal');
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.acceptSilently);
  });

  it('returns normal for a typical coloured card image (mid saturation)', () => {
    // Typical art: reasonably saturated but not extreme
    const rgba = solidRgba(100, 60, 30, 400); // brownish - mid saturation
    const result = inferFoil(rgba, 20, 20);
    expect(result.value).toBe('normal');
    // Mid-saturation should produce confidence in the uncertain range
    expect(result.confidence).toBeLessThan(DEFAULT_THRESHOLDS.acceptSilently);
  });

  it('returns foil for high mean saturation with high variance', () => {
    // Simulate foil glare: mix vivid coloured pixels (sat=1) with near-grey pixels (sat≈0)
    // → mean sat ≈ 0.5 (above 0.35 threshold), variance ≈ 0.25 (above 0.04 threshold)
    const count = 400;
    const rgba = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0) {
        // Fully saturated red (sat=1.0)
        rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0;
      } else {
        // Near-grey (sat≈0)
        rgba[i * 4] = 128; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 128;
      }
      rgba[i * 4 + 3] = 255;
    }
    const result = inferFoil(rgba, 20, 20);
    expect(result.value).toBe('foil');
    expect(result.confidence).toBeGreaterThan(DEFAULT_THRESHOLDS.acceptAndFlag);
  });

  it('handles empty image gracefully', () => {
    const result = inferFoil(new Uint8Array(0), 0, 0);
    expect(result.value).toBe('normal');
    expect(result.confidence).toBeGreaterThan(0);
  });

  describe('etched-foil detection via EtchedContext', () => {
    function foilLikeRgba(): Uint8Array {
      // Mix saturated + grey → triggers foil heuristic
      const count = 400;
      const rgba = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        if (i % 2 === 0) {
          rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0;
        } else {
          rgba[i * 4] = 128; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 128;
        }
        rgba[i * 4 + 3] = 255;
      }
      return rgba;
    }

    it('returns etched when printing has etched finish + etched price and pixels look foil-like', () => {
      const ctx: EtchedContext = { finishes: ['normal', 'etched'], priceUsdEtched: 12.5 };
      const result = inferFoil(foilLikeRgba(), 20, 20, ctx);
      expect(result.value).toBe('etched');
      expect(result.confidence).toBeGreaterThan(DEFAULT_THRESHOLDS.acceptAndFlag);
    });

    it('returns foil when printing has etched finish but no etched price', () => {
      const ctx: EtchedContext = { finishes: ['etched'], priceUsdEtched: null };
      const result = inferFoil(foilLikeRgba(), 20, 20, ctx);
      expect(result.value).toBe('foil');
    });

    it('returns foil when printing has no etched finish even with etched price', () => {
      const ctx: EtchedContext = { finishes: ['normal', 'foil'], priceUsdEtched: 12.5 };
      const result = inferFoil(foilLikeRgba(), 20, 20, ctx);
      expect(result.value).toBe('foil');
    });

    it('returns normal when pixels are not foil-like regardless of context', () => {
      const ctx: EtchedContext = { finishes: ['etched'], priceUsdEtched: 12.5 };
      const rgba = solidRgba(50, 50, 52, 1000); // near-greyscale
      const result = inferFoil(rgba, 100, 10, ctx);
      expect(result.value).toBe('normal');
    });
  });
});

// ── inferLanguage ─────────────────────────────────────────────────────────────

describe('inferLanguage', () => {
  it('returns EN with high confidence for "en" lang code', () => {
    const result = inferLanguage('en');
    expect(result.value).toBe('EN');
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.acceptSilently);
  });

  it('maps Japanese correctly', () => {
    const result = inferLanguage('ja');
    expect(result.value).toBe('JA');
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.acceptSilently);
  });

  it('maps German correctly', () => {
    expect(inferLanguage('de').value).toBe('DE');
  });

  it('uppercases unknown codes', () => {
    const result = inferLanguage('xx');
    expect(result.value).toBe('XX');
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.acceptSilently);
  });

  it('returns low confidence when lang is null', () => {
    const result = inferLanguage(null);
    expect(result.value).toBe('EN');
    expect(result.confidence).toBeLessThan(DEFAULT_THRESHOLDS.acceptAndFlag);
  });

  it('is case-insensitive', () => {
    expect(inferLanguage('JA').value).toBe('JA');
    expect(inferLanguage('EN').value).toBe('EN');
  });
});

// ── inferPrice ────────────────────────────────────────────────────────────────

describe('inferPrice', () => {
  it('returns normal price for normal foil', () => {
    const result = inferPrice(2.5, 5.0, 'normal');
    expect(result.value).toBe(2.5);
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.acceptSilently);
  });

  it('returns foil price for foil finish', () => {
    const result = inferPrice(2.5, 5.0, 'foil');
    expect(result.value).toBe(5.0);
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.acceptSilently);
  });

  it('falls back to normal price when foil price is null', () => {
    const result = inferPrice(2.5, null, 'foil');
    expect(result.value).toBe(2.5);
  });

  it('returns null when no price data is available', () => {
    const result = inferPrice(null, null, 'normal');
    expect(result.value).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('falls back to normal price for etched when no etched price supplied', () => {
    const result = inferPrice(2.5, 4.0, 'etched');
    expect(result.value).toBe(2.5);
  });

  it('uses etched price when available and foil is etched', () => {
    const result = inferPrice(2.5, 4.0, 'etched', 3.0);
    expect(result.value).toBe(3.0);
  });

  it('falls back to normal price when etched price is null', () => {
    const result = inferPrice(2.5, 4.0, 'etched', null);
    expect(result.value).toBe(2.5);
  });
});

// ── planCatalogueAdditionWithInferences ───────────────────────────────────────

describe('planCatalogueAdditionWithInferences', () => {
  const baseInput = {
    scryfall_id: 'sf-1',
    name: 'Lightning Bolt',
    set_code: 'm10',
    set_name: 'Magic 2010',
    collector_number: '146',
    collection_id: 1,
    now: 1_000_000,
  };

  const highConfidenceInferences: FieldInferences = {
    foil: { value: 'normal', confidence: 0.85 },
    language: { value: 'EN', confidence: 0.92 },
    price: { value: 1.23, confidence: 0.95 },
  };

  it('inserts with no review when all inferences are high confidence', () => {
    const action = planCatalogueAdditionWithInferences(null, baseInput, highConfidenceInferences);
    expect(action.kind).toBe('insert');
    if (action.kind !== 'insert') return;
    expect(action.row.needs_review).toBe(0);
    expect(action.row.review_reasons).toBeNull();
    expect(action.row.foil).toBe('normal');
    expect(action.row.language).toBe('EN');
    expect(action.row.price_at_first_scan_usd).toBe(1.23);
  });

  it('flags foil when foil confidence is below acceptSilently (accept-flag range)', () => {
    const inferences: FieldInferences = {
      ...highConfidenceInferences,
      foil: { value: 'normal', confidence: 0.48 },
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, inferences);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.needs_review).toBe(1);
    const reasons = JSON.parse(action.row.review_reasons!) as string[];
    expect(reasons).toContain('low_confidence_field:foil');
    expect(reasons).not.toContain('low_confidence_field:language');
    expect(action.row.foil).toBe('normal'); // inferred value used even at low confidence
  });

  it('flags foil and uses default when confidence is below acceptAndFlag (blank-flag)', () => {
    const inferences: FieldInferences = {
      ...highConfidenceInferences,
      foil: { value: 'foil', confidence: 0.2 },
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, inferences);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.needs_review).toBe(1);
    expect(action.row.foil).toBe('normal'); // default used, not the low-confidence value
    const reasons = JSON.parse(action.row.review_reasons!) as string[];
    expect(reasons).toContain('low_confidence_field:foil');
  });

  it('flags language when language confidence is low', () => {
    const inferences: FieldInferences = {
      ...highConfidenceInferences,
      language: { value: 'EN', confidence: 0.3 },
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, inferences);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.needs_review).toBe(1);
    const reasons = JSON.parse(action.row.review_reasons!) as string[];
    expect(reasons).toContain('low_confidence_field:language');
  });

  it('carries multiple reasons when both foil and language are flagged', () => {
    const inferences: FieldInferences = {
      foil: { value: 'normal', confidence: 0.48 },
      language: { value: 'EN', confidence: 0.3 },
      price: { value: 1.23, confidence: 0.95 },
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, inferences);
    if (action.kind !== 'insert') throw new Error('expected insert');
    const reasons = JSON.parse(action.row.review_reasons!) as string[];
    expect(reasons).toContain('low_confidence_field:foil');
    expect(reasons).toContain('low_confidence_field:language');
  });

  it('does not raise review flag for null price (price absence is not user-actionable)', () => {
    const inferences: FieldInferences = {
      ...highConfidenceInferences,
      price: { value: null, confidence: 0 },
    };
    const action = planCatalogueAdditionWithInferences(null, baseInput, inferences);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.needs_review).toBe(0);
    expect(action.row.review_reasons).toBeNull();
    expect(action.row.price_at_first_scan_usd).toBeNull();
  });

  it('returns bump when existing row matches dedup key', () => {
    const existing: CardsRow = {
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
      quantity: 2,
      price_at_first_scan_usd: 1.23,
      notes: null,
      needs_review: 0,
      review_reasons: null,
      first_seen_at: 900_000,
      last_seen_at: 950_000,
    };
    const action = planCatalogueAdditionWithInferences(existing, baseInput, highConfidenceInferences);
    expect(action.kind).toBe('bump');
    if (action.kind !== 'bump') return;
    expect(action.cardId).toBe(42);
    expect(action.newQuantity).toBe(3);
  });

  it('always inserts condition as NM (manual-only field)', () => {
    const action = planCatalogueAdditionWithInferences(null, baseInput, highConfidenceInferences);
    if (action.kind !== 'insert') throw new Error('expected insert');
    expect(action.row.condition).toBe('NM');
  });
});
