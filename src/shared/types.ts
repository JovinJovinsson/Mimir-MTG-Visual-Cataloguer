export type Foil = 'normal' | 'foil' | 'etched';
export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

export interface AddCardInput {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  collection_id: number;
  foil: Foil;
  condition: Condition;
  language: string;
  price_usd: number | null;
  now: number;
}

export interface CardsRow {
  id: number;
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  collection_id: number;
  foil: Foil;
  condition: Condition;
  language: string;
  quantity: number;
  price_at_first_scan_usd: number | null;
  notes: string | null;
  needs_review: 0 | 1;
  review_reasons: string | null;
  first_seen_at: number;
  last_seen_at: number;
}

export type CardsInsert = Omit<CardsRow, 'id'>;

export type CatalogueAddAction =
  | { kind: 'insert'; row: CardsInsert }
  | { kind: 'bump'; cardId: number; newQuantity: number; lastSeenAt: number };

export type CatalogueAction =
  | CatalogueAddAction
  | { kind: 'update-collection'; cardId: number; collectionId: number }
  | { kind: 'delete-card'; cardId: number };

export interface CardForRenderer {
  id: number;
  scryfall_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  collection_id: number;
  foil: Foil;
  condition: Condition;
  language: string;
  quantity: number;
  price_usd: number | null;
  last_seen_at: number;
  needs_review: boolean;
  review_reasons: string | null;
}

export interface CollectionRow {
  id: number;
  name: string;
  is_wishlist: 0 | 1;
  created_at: number;
  sort_order: number;
}

export interface CollectionForRenderer {
  id: number;
  name: string;
  is_wishlist: boolean;
  sort_order: number;
  count: number;
}

export interface ScansRow {
  id: number;
  card_id: number | null;
  captured_at: number;
  thumbnail_path: string | null;
  phash: string | null;
  confidence_score: number | null;
  inferences_json: string | null;
  needed_manual_review: 0 | 1;
}

export type ScansInsert = Omit<ScansRow, 'id'>;

export interface ScanForRenderer {
  id: number;
  captured_at: number;
  thumbnail_path: string | null;
}

export type ReviewReason = 'ambiguous_identity' | 'unknown_card' | 'manual_flagged' | 'low_confidence_field';

export interface ReviewCandidate {
  scryfallId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  priceUsd: number | null;
  hammingDistance: number;
  artCropPath: string | null;
}

export interface ReviewItemDto {
  id: number;
  scanId: number | null;
  reason: ReviewReason;
  candidates: ReviewCandidate[];
  thumbnailPath: string | null;
  capturedAt: number;
  createdAt: number;
  // Present only for low_confidence_field items
  flaggedFields?: string[];
  resolvedCardId?: number;
  inferredValues?: Record<string, string>;
}
