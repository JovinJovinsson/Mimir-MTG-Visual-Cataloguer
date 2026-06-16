export const BASE_INTERVAL_MS = 60_000; // 1 minute
export const MAX_INTERVAL_MS = 3_600_000; // 1 hour

/**
 * Computes the timestamp for the next enrichment retry, or null when the
 * exponential backoff interval would reach or exceed 1 hour (giving up).
 */
export function nextEnrichmentRetryAt(
  consecutiveFailures: number,
  lastAttemptedAt: number,
  _now: number,
): number | null {
  const interval = BASE_INTERVAL_MS * (2 ** consecutiveFailures);
  if (interval >= MAX_INTERVAL_MS) return null;
  return lastAttemptedAt + interval;
}
