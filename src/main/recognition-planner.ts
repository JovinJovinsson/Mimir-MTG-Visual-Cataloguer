import { planCatalogueAddition } from './planner.js';
import type { CatalogueAddAction, CardsRow } from '../shared/types.js';
import type { RecognitionResult } from './recognition-pipeline.js';

export type RecognitionCatalogueAction =
  | CatalogueAddAction
  | { kind: 'skip'; reason: 'no-match' | 'error' };

export function planRecognitionCatalogueAction(
  existing: CardsRow | null,
  result: RecognitionResult,
  inboxCollectionId: number,
  now: number = Date.now(),
  _scanModePreset: null = null,
): RecognitionCatalogueAction {
  if (result.kind === 'error') {
    return { kind: 'skip', reason: 'error' };
  }
  if (result.kind === 'no-match') {
    return { kind: 'skip', reason: 'no-match' };
  }

  const { match } = result;
  const collectionId = existing?.collection_id ?? inboxCollectionId;

  const base = planCatalogueAddition(existing, {
    scryfall_id: match.scryfallId,
    name: match.name,
    set_code: match.setCode,
    set_name: match.setName,
    collector_number: match.collectorNumber,
    collection_id: collectionId,
    foil: 'normal',
    condition: 'NM',
    language: 'EN',
    price_usd: match.priceUsd,
    now,
  });

  return base;
}
