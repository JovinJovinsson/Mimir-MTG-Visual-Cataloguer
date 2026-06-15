export type UpdateCheckResult = 'needs-refresh' | 'current';

export function checkNeedsRefresh(
  localLastIngestedAt: number | null,
  remoteUpdatedAt: string,
): UpdateCheckResult {
  if (localLastIngestedAt == null) return 'needs-refresh';
  const remoteMs = Date.parse(remoteUpdatedAt);
  if (!Number.isFinite(remoteMs)) return 'current';
  return remoteMs > localLastIngestedAt ? 'needs-refresh' : 'current';
}
