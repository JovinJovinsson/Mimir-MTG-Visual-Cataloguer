import { computePHash, hammingDistance } from './phash.js';

export const MATCH_THRESHOLD = 10;

export interface HashedCard {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  price_usd: number | null;
  phash: string;
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
