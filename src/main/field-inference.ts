import type { Foil } from '../shared/types.js';

export interface InferenceResult<T> {
  value: T;
  confidence: number; // [0.0, 1.0]
}

export interface EtchedContext {
  finishes: Foil[];
  priceUsdEtched: number | null;
}

export interface InferenceThresholds {
  acceptSilently: number; // above → accept, no flag
  acceptAndFlag: number;  // above (but below acceptSilently) → accept + flag for review
  // below acceptAndFlag → use default + flag for review
}

export type InferenceDecision = 'accept' | 'accept-flag' | 'blank-flag';

export const DEFAULT_THRESHOLDS: InferenceThresholds = {
  acceptSilently: 0.75,
  acceptAndFlag: 0.4,
};

export function classifyInference<T>(
  result: InferenceResult<T>,
  thresholds: InferenceThresholds = DEFAULT_THRESHOLDS,
): InferenceDecision {
  if (result.confidence >= thresholds.acceptSilently) return 'accept';
  if (result.confidence >= thresholds.acceptAndFlag) return 'accept-flag';
  return 'blank-flag';
}

const SCRYFALL_LANG_MAP: Record<string, string> = {
  en: 'EN', ja: 'JA', de: 'DE', fr: 'FR', es: 'ES', it: 'IT',
  pt: 'PT', ko: 'KO', ru: 'RU', zhs: 'ZHS', zht: 'ZHT',
  he: 'HE', la: 'LA', grc: 'GRC', ar: 'AR', sa: 'SA', ph: 'PH',
};

/**
 * Infer foil status from raw RGBA pixel data.
 * Foil cards produce higher saturation and higher saturation variance due to glare.
 * When etchedCtx is provided and the printing carries an etched finish with an
 * etched price, a foil-like pixel signal is reclassified as "etched".
 */
export function inferFoil(
  rgba: Uint8Array,
  width: number,
  height: number,
  etchedCtx?: EtchedContext,
): InferenceResult<Foil> {
  const count = width * height;
  if (count === 0) return { value: 'normal', confidence: 0.5 };

  let totalSat = 0;
  let totalSatSq = 0;

  for (let i = 0; i < count; i++) {
    const base = i * 4;
    const r = rgba[base]! / 255;
    const g = rgba[base + 1]! / 255;
    const b = rgba[base + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    totalSat += sat;
    totalSatSq += sat * sat;
  }

  const meanSat = totalSat / count;
  const variance = totalSatSq / count - meanSat * meanSat;

  // High saturation variance + high mean saturation → rainbow glare → foil-like
  if (meanSat > 0.35 && variance > 0.04) {
    // If the printing supports etched and has an etched price, classify as etched
    if (
      etchedCtx &&
      etchedCtx.finishes.includes('etched') &&
      etchedCtx.priceUsdEtched != null
    ) {
      return { value: 'etched', confidence: 0.65 };
    }
    return { value: 'foil', confidence: 0.65 };
  }
  // Very low saturation → near-greyscale → very likely non-foil
  if (meanSat < 0.12) {
    return { value: 'normal', confidence: 0.82 };
  }
  // Mid saturation (most MTG art) → probably normal but uncertain
  return { value: 'normal', confidence: 0.48 };
}

/**
 * Infer language from the Scryfall printing's lang field.
 * High confidence when metadata is present; low confidence when missing.
 */
export function inferLanguage(scryfallLang: string | null): InferenceResult<string> {
  if (!scryfallLang) {
    return { value: 'EN', confidence: 0.3 };
  }
  const display = SCRYFALL_LANG_MAP[scryfallLang.toLowerCase()] ?? scryfallLang.toUpperCase();
  return { value: display, confidence: 0.92 };
}

/**
 * Infer price from Scryfall pricing data for the resolved printing.
 * High confidence whenever price data exists; null value when absent (not user-actionable).
 */
export function inferPrice(
  priceUsd: number | null,
  priceUsdFoil: number | null,
  foil: Foil,
  priceUsdEtched?: number | null,
): InferenceResult<number | null> {
  let price: number | null;
  if (foil === 'etched') {
    price = (priceUsdEtched ?? null) ?? priceUsd;
  } else if (foil === 'foil') {
    price = priceUsdFoil ?? priceUsd;
  } else {
    price = priceUsd;
  }
  if (price == null) {
    return { value: null, confidence: 0 };
  }
  return { value: price, confidence: 0.95 };
}
