import { planCatalogueAddition } from './planner.js';
import type { CardsRow, CardsInsert, ReviewCandidate } from '../shared/types.js';

export type { ReviewCandidate };

export interface ReviewItemForResolver {
  id: number;
  scanId: number | null;
  candidates: ReviewCandidate[];
}

export type UserResolution =
  | { kind: 'confirm'; scryfallId: string }
  | { kind: 'skip' }
  | { kind: 'dismiss' };

export type ReviewAction =
  | { kind: 'insert'; row: CardsInsert }
  | { kind: 'bump'; cardId: number; newQuantity: number; lastSeenAt: number }
  | { kind: 'update-scan-card'; scanId: number; cardId: number | null }
  | { kind: 'resolve-review-queue'; reviewId: number; scryfallId: string }
  | { kind: 'skip-review-queue'; reviewId: number }
  | { kind: 'dismiss-review-queue'; reviewId: number }
  | { kind: 'delete-scan'; scanId: number };

export function resolveReviewItem(
  item: ReviewItemForResolver,
  resolution: UserResolution,
  existingCard: CardsRow | null,
  inboxCollectionId: number,
  now: number,
): ReviewAction[] {
  if (resolution.kind === 'skip') {
    return [{ kind: 'skip-review-queue', reviewId: item.id }];
  }

  if (resolution.kind === 'dismiss') {
    const actions: ReviewAction[] = [];
    if (item.scanId != null) {
      actions.push({ kind: 'delete-scan', scanId: item.scanId });
    }
    actions.push({ kind: 'dismiss-review-queue', reviewId: item.id });
    return actions;
  }

  // confirm
  const candidate = item.candidates.find((c) => c.scryfallId === resolution.scryfallId);
  if (!candidate) {
    return [{ kind: 'resolve-review-queue', reviewId: item.id, scryfallId: resolution.scryfallId }];
  }

  const collectionId = existingCard?.collection_id ?? inboxCollectionId;

  const catalogueAction = planCatalogueAddition(existingCard, {
    scryfall_id: candidate.scryfallId,
    name: candidate.name,
    set_code: candidate.setCode,
    set_name: candidate.setName,
    collector_number: candidate.collectorNumber,
    collection_id: collectionId,
    foil: 'normal',
    condition: 'NM',
    language: 'EN',
    price_usd: candidate.priceUsd,
    now,
  });

  const actions: ReviewAction[] = [catalogueAction];

  if (item.scanId != null) {
    const knownCardId = catalogueAction.kind === 'bump' ? catalogueAction.cardId : null;
    actions.push({ kind: 'update-scan-card', scanId: item.scanId, cardId: knownCardId });
  }

  actions.push({ kind: 'resolve-review-queue', reviewId: item.id, scryfallId: candidate.scryfallId });

  return actions;
}
