export interface SkippedScan {
  setCode: string;
  setName: string;
}

export interface SuggestedSet {
  setCode: string;
  setName: string;
  count: number;
}

export function detectSuggestedSet(
  recentSkippedScans: SkippedScan[],
  threshold: number,
): SuggestedSet | null {
  if (recentSkippedScans.length === 0 || threshold <= 0) return null;

  const counts = new Map<string, { setName: string; count: number }>();
  for (const scan of recentSkippedScans) {
    const existing = counts.get(scan.setCode);
    if (existing) {
      existing.count++;
    } else {
      counts.set(scan.setCode, { setName: scan.setName, count: 1 });
    }
  }

  let best: SuggestedSet | null = null;
  for (const [setCode, { setName, count }] of counts) {
    if (count >= threshold && (!best || count > best.count)) {
      best = { setCode, setName, count };
    }
  }

  return best;
}
