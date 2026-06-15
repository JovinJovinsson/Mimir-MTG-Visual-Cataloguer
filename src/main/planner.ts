import type {
  AddCardInput,
  CardsRow,
  CardsInsert,
  CatalogueAddAction,
  Foil,
} from '../shared/types.js';
import {
  type InferenceResult,
  type InferenceThresholds,
  DEFAULT_THRESHOLDS,
  classifyInference,
} from './field-inference.js';

export interface FieldInferences {
  foil: InferenceResult<Foil>;
  language: InferenceResult<string>;
  price: InferenceResult<number | null>;
}

function matchesDedupKey(row: CardsRow, input: AddCardInput): boolean {
  return (
    row.scryfall_id === input.scryfall_id &&
    row.foil === input.foil &&
    row.condition === input.condition &&
    row.language === input.language &&
    row.collection_id === input.collection_id
  );
}

export function planCatalogueAddition(
  existing: CardsRow | null,
  input: AddCardInput,
): CatalogueAddAction {
  if (existing) {
    if (existing.scryfall_id !== input.scryfall_id) {
      throw new Error(
        `planCatalogueAddition: existing row scryfall_id (${existing.scryfall_id}) does not match input (${input.scryfall_id})`,
      );
    }
    if (matchesDedupKey(existing, input)) {
      return {
        kind: 'bump',
        cardId: existing.id,
        newQuantity: existing.quantity + 1,
        lastSeenAt: input.now,
      };
    }
  }

  const row: CardsInsert = {
    scryfall_id: input.scryfall_id,
    name: input.name,
    set_code: input.set_code,
    set_name: input.set_name,
    collector_number: input.collector_number,
    collection_id: input.collection_id,
    foil: input.foil,
    condition: input.condition,
    language: input.language,
    quantity: 1,
    price_at_first_scan_usd: input.price_usd,
    notes: null,
    needs_review: 0,
    review_reasons: null,
    first_seen_at: input.now,
    last_seen_at: input.now,
  };
  return { kind: 'insert', row };
}

/**
 * Like planCatalogueAddition but resolves foil/language/price from per-field inference results
 * and annotates the resulting row with review_reasons and needs_review when fields are uncertain.
 * Condition is always 'NM' (manual-only field, never inferred).
 */
export function planCatalogueAdditionWithInferences(
  existing: CardsRow | null,
  baseInput: Omit<AddCardInput, 'foil' | 'language' | 'price_usd' | 'condition'>,
  inferences: FieldInferences,
  thresholds: InferenceThresholds = DEFAULT_THRESHOLDS,
): CatalogueAddAction {
  const foilDecision = classifyInference(inferences.foil, thresholds);
  const langDecision = classifyInference(inferences.language, thresholds);

  const reviewReasons: string[] = [];

  let foilValue: Foil;
  if (foilDecision === 'accept') {
    foilValue = inferences.foil.value;
  } else if (foilDecision === 'accept-flag') {
    foilValue = inferences.foil.value;
    reviewReasons.push('low_confidence_field:foil');
  } else {
    foilValue = 'normal';
    reviewReasons.push('low_confidence_field:foil');
  }

  let langValue: string;
  if (langDecision === 'accept') {
    langValue = inferences.language.value;
  } else if (langDecision === 'accept-flag') {
    langValue = inferences.language.value;
    reviewReasons.push('low_confidence_field:language');
  } else {
    langValue = 'EN';
    reviewReasons.push('low_confidence_field:language');
  }

  // Price absence is not user-actionable; use inferred value regardless of confidence.
  const priceValue = inferences.price.value;

  const fullInput: AddCardInput = {
    ...baseInput,
    foil: foilValue,
    language: langValue,
    price_usd: priceValue,
    condition: 'NM',
  };

  const baseAction = planCatalogueAddition(existing, fullInput);

  if (baseAction.kind === 'insert' && reviewReasons.length > 0) {
    return {
      kind: 'insert',
      row: {
        ...baseAction.row,
        needs_review: 1,
        review_reasons: JSON.stringify(reviewReasons),
      },
    };
  }

  return baseAction;
}
