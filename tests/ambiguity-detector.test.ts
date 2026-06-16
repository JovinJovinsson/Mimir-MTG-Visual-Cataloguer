import { describe, it, expect } from 'vitest';
import { detectAmbiguity, GLARE_THRESHOLD, CANDIDATE_GAP_THRESHOLD } from '../src/main/ambiguity-detector.js';
import type { ReviewCandidate } from '../src/shared/types.js';

function candidate(hammingDistance: number): ReviewCandidate {
  return {
    scryfallId: 'abc',
    name: 'Test Card',
    setCode: 'tst',
    setName: 'Test Set',
    collectorNumber: '1',
    priceUsd: null,
    hammingDistance,
    artCropPath: null,
  };
}

describe('detectAmbiguity', () => {
  it('accepts when there are no candidates', () => {
    expect(detectAmbiguity([], 1.0)).toBe('accept');
  });

  it('accepts when there is only one candidate regardless of glare', () => {
    expect(detectAmbiguity([candidate(2)], 1.0)).toBe('accept');
  });

  it('accepts when glare is below threshold even if candidates are close', () => {
    const candidates = [candidate(1), candidate(2)];
    expect(detectAmbiguity(candidates, GLARE_THRESHOLD - 0.01)).toBe('accept');
  });

  it('accepts when candidates have a clear gap despite high glare', () => {
    const candidates = [candidate(1), candidate(1 + CANDIDATE_GAP_THRESHOLD)];
    expect(detectAmbiguity(candidates, 1.0)).toBe('accept');
  });

  it('flags ambiguous_identity when glare is high and candidates are too close', () => {
    const candidates = [candidate(2), candidate(2 + CANDIDATE_GAP_THRESHOLD - 1)];
    expect(detectAmbiguity(candidates, GLARE_THRESHOLD + 0.01)).toBe('ambiguous_identity');
  });

  it('uses only the top two candidates for the gap calculation', () => {
    // Top two are close → ambiguous even if rest are far away
    const candidates = [candidate(1), candidate(2), candidate(20), candidate(30)];
    expect(detectAmbiguity(candidates, 1.0)).toBe('ambiguous_identity');
  });

  it('accepts exactly at the gap boundary', () => {
    const candidates = [candidate(1), candidate(1 + CANDIDATE_GAP_THRESHOLD)];
    expect(detectAmbiguity(candidates, 1.0)).toBe('accept');
  });
});
