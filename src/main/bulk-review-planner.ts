import { planCatalogueAddition } from './planner.js';
import type { ReviewAction, ReviewItemForResolver } from './review-resolver.js';
import type { CardsRow } from '../shared/types.js';

export type BulkAction =
  | { kind: 'dismiss-all' }
  | { kind: 'confirm-all-foil' }
  | { kind: 'mark-all-as-set'; setCode: string };

export interface BulkReviewItemInput {
  item: ReviewItemForResolver;
  existingCard: CardsRow | null;
}

export function planBulkReviewAction(
  inputs: BulkReviewItemInput[],
  action: BulkAction,
  inboxCollectionId: number,
  now: number,
): ReviewAction[] {
  const actions: ReviewAction[] = [];

  for (const { item, existingCard } of inputs) {
    if (action.kind === 'dismiss-all') {
      if (item.scanId != null) {
        actions.push({ kind: 'delete-scan', scanId: item.scanId });
      }
      actions.push({ kind: 'dismiss-review-queue', reviewId: item.id });
      continue;
    }

    if (action.kind === 'confirm-all-foil') {
      const candidate = item.candidates[0];
      if (!candidate) continue;

      const collectionId = existingCard?.collection_id ?? inboxCollectionId;
      const catalogueAction = planCatalogueAddition(existingCard, {
        scryfall_id: candidate.scryfallId,
        name: candidate.name,
        set_code: candidate.setCode,
        set_name: candidate.setName,
        collector_number: candidate.collectorNumber,
        collection_id: collectionId,
        foil: 'foil',
        condition: 'NM',
        language: 'EN',
        price_usd: candidate.priceUsd,
        now,
      });

      actions.push(catalogueAction);

      if (item.scanId != null) {
        const knownCardId = catalogueAction.kind === 'bump' ? catalogueAction.cardId : null;
        actions.push({ kind: 'update-scan-card', scanId: item.scanId, cardId: knownCardId });
      }

      actions.push({ kind: 'resolve-review-queue', reviewId: item.id, scryfallId: candidate.scryfallId });
      continue;
    }

    if (action.kind === 'mark-all-as-set') {
      const candidate = item.candidates.find((c) => c.setCode === action.setCode);
      if (!candidate) continue;

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

      actions.push(catalogueAction);

      if (item.scanId != null) {
        const knownCardId = catalogueAction.kind === 'bump' ? catalogueAction.cardId : null;
        actions.push({ kind: 'update-scan-card', scanId: item.scanId, cardId: knownCardId });
      }

      actions.push({ kind: 'resolve-review-queue', reviewId: item.id, scryfallId: candidate.scryfallId });
    }
  }

  return actions;
}
