import { computePHash, hammingDistance } from './phash.js';
import type { ReviewCandidate } from '../shared/types.js';

export const MATCH_THRESHOLD = 10;
export const SILENT_ACCEPT_THRESHOLD = 5;

export interface HashedCard {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  price_usd: number | null;
  phash: string;
}

export interface HashedCardWithCrop extends HashedCard {
  art_crop_path: string | null;
  lang: string;
  price_usd_foil: number | null;
}

export function getTopNCandidates(
  phash: string,
  cards: HashedCardWithCrop[],
  n: number,
): ReviewCandidate[] {
  const scored: Array<{ card: HashedCardWithCrop; dist: number }> = [];

  for (const card of cards) {
    try {
      const dist = hammingDistance(phash, card.phash);
      scored.push({ card, dist });
    } catch {
      // skip cards with malformed phash
    }
  }

  scored.sort((a, b) => a.dist - b.dist);

  return scored.slice(0, n).map(({ card, dist }) => ({
    scryfallId: card.scryfall_id,
    name: card.name,
    setCode: card.set_code,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    priceUsd: card.price_usd,
    hammingDistance: dist,
    artCropPath: card.art_crop_path,
  }));
}

export interface RecognitionIndex {
  getAllHashedCards(): HashedCard[];
}

export interface RecognitionMatch {
  scryfallId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  priceUsd: number | null;
  hammingDistance: number;
}

export type RecognitionResult =
  | { kind: 'matched'; phash: string; match: RecognitionMatch; confidenceScore: number }
  | { kind: 'no-match'; phash: string; confidenceScore: number }
  | { kind: 'error' };

export function recognizeCard(
  rgba: Uint8Array,
  width: number,
  height: number,
  index: RecognitionIndex,
): RecognitionResult {
  let phash: string;
  try {
    phash = computePHash(rgba, width, height);
  } catch {
    return { kind: 'error' };
  }

  const cards = index.getAllHashedCards();
  if (cards.length === 0) {
    return { kind: 'no-match', phash, confidenceScore: 0 };
  }

  let bestCard: HashedCard | null = null;
  let bestDist = Infinity;

  for (const card of cards) {
    try {
      const d = hammingDistance(phash, card.phash);
      if (d < bestDist) {
        bestDist = d;
        bestCard = card;
      }
    } catch {
      // Skip cards with malformed phash
    }
  }

  const confidenceScore = bestCard && Number.isFinite(bestDist) ? 1 - bestDist / 64 : 0;

  if (bestCard && bestDist <= MATCH_THRESHOLD) {
    return {
      kind: 'matched',
      phash,
      match: {
        scryfallId: bestCard.scryfall_id,
        name: bestCard.name,
        setCode: bestCard.set_code,
        setName: bestCard.set_name,
        collectorNumber: bestCard.collector_number,
        priceUsd: bestCard.price_usd,
        hammingDistance: bestDist,
      },
      confidenceScore,
    };
  }

  return { kind: 'no-match', phash, confidenceScore };
}
