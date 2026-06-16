import { describe, it, expect } from 'vitest';
import { nextEnrichmentRetryAt, BASE_INTERVAL_MS, MAX_INTERVAL_MS } from '../src/main/enrichment-retry.js';

describe('nextEnrichmentRetryAt', () => {
  const now = 1_000_000;

  it('schedules first retry one base interval after last attempt', () => {
    const result = nextEnrichmentRetryAt(0, now, now);
    expect(result).toBe(now + BASE_INTERVAL_MS);
  });

  it('doubles the interval with each consecutive failure', () => {
    expect(nextEnrichmentRetryAt(1, now, now)).toBe(now + BASE_INTERVAL_MS * 2);
    expect(nextEnrichmentRetryAt(2, now, now)).toBe(now + BASE_INTERVAL_MS * 4);
    expect(nextEnrichmentRetryAt(3, now, now)).toBe(now + BASE_INTERVAL_MS * 8);
  });

  it('returns null when the computed interval meets or exceeds 1 hour', () => {
    // Find where interval first reaches MAX_INTERVAL_MS
    let n = 0;
    while (BASE_INTERVAL_MS * (2 ** n) < MAX_INTERVAL_MS) n++;
    expect(nextEnrichmentRetryAt(n, now, now)).toBeNull();
  });

  it('still schedules retry one step before the cutoff', () => {
    let n = 0;
    while (BASE_INTERVAL_MS * (2 ** n) < MAX_INTERVAL_MS) n++;
    // n-1 is the last valid failure count
    const result = nextEnrichmentRetryAt(n - 1, now, now);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(now);
  });

  it('returns null for very large failure counts', () => {
    expect(nextEnrichmentRetryAt(100, now, now)).toBeNull();
  });

  it('is pure — now parameter does not affect output', () => {
    const a = nextEnrichmentRetryAt(0, now, now);
    const b = nextEnrichmentRetryAt(0, now, now + 999_999);
    expect(a).toBe(b);
  });
});
