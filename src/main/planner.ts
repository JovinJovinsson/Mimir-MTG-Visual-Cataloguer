import type {
  AddCardInput,
  CardsRow,
  CardsInsert,
  CatalogueAddAction,
} from '../shared/types.js';

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
