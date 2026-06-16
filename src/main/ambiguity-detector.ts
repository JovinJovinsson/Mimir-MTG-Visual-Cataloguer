import type { ReviewCandidate } from '../shared/types.js';

export const GLARE_THRESHOLD = 0.6;
export const CANDIDATE_GAP_THRESHOLD = 3;

/**
 * Decides whether high foil glare makes a pHash match unreliable.
 * Glare can distort art hues, causing two similarly-coloured candidates to
 * have nearly equal Hamming distances even when one is clearly the right card.
 */
export function detectAmbiguity(
  phashTopMatches: ReviewCandidate[],
  glareSignal: number,
): 'accept' | 'ambiguous_identity' {
  if (phashTopMatches.length < 2) return 'accept';
  if (glareSignal < GLARE_THRESHOLD) return 'accept';

  const first = phashTopMatches[0]!;
  const second = phashTopMatches[1]!;
  const gap = second.hammingDistance - first.hammingDistance;
  if (gap >= CANDIDATE_GAP_THRESHOLD) return 'accept';

  return 'ambiguous_identity';
}
