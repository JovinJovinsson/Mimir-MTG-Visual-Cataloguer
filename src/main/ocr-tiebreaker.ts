import type { ReviewCandidate } from '../shared/types.js';
import type { AutocompleteHitDto } from '../shared/ipc.js';

export type OcrDecision =
  | { kind: 'boosted-accept'; candidate: ReviewCandidate }
  | { kind: 'ambiguous'; candidates: ReviewCandidate[] }
  | { kind: 'resolve-by-name'; candidates: AutocompleteHitDto[] }
  | { kind: 'unknown' };

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? (prev[j - 1] ?? 0)
        : 1 + Math.min(prev[j] ?? 0, curr[j - 1] ?? 0, prev[j - 1] ?? 0);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[n] ?? 0;
}

function isFuzzyMatch(ocrText: string, candidateName: string): boolean {
  const a = ocrText.toLowerCase().trim();
  const b = candidateName.toLowerCase().trim();
  if (!a || !b) return false;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  return dist / maxLen <= 0.3;
}

export function resolveWithOcr(
  topNCandidates: ReviewCandidate[],
  ocrText: string,
  lookupByName: (name: string) => AutocompleteHitDto[],
): OcrDecision {
  if (!ocrText.trim()) return { kind: 'unknown' };

  const matching = topNCandidates.filter((c) => isFuzzyMatch(ocrText, c.name));

  if (matching.length === 1) {
    return { kind: 'boosted-accept', candidate: matching[0]! };
  }

  if (matching.length > 1) {
    return { kind: 'ambiguous', candidates: matching };
  }

  const hits = lookupByName(ocrText);
  if (hits.length > 0) {
    return { kind: 'resolve-by-name', candidates: hits };
  }

  return { kind: 'unknown' };
}
