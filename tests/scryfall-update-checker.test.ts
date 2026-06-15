import { describe, it, expect } from 'vitest';
import { checkNeedsRefresh } from '../src/main/scryfall-update-checker.js';

describe('checkNeedsRefresh', () => {
  it('returns needs-refresh when local timestamp is null (never fetched)', () => {
    expect(checkNeedsRefresh(null, '2026-06-13T00:00:00.000Z')).toBe('needs-refresh');
  });

  it('returns needs-refresh when remote is newer than local', () => {
    const local = Date.parse('2026-06-01T00:00:00.000Z');
    expect(checkNeedsRefresh(local, '2026-06-13T00:00:00.000Z')).toBe('needs-refresh');
  });

  it('returns current when local is same timestamp as remote', () => {
    const ts = Date.parse('2026-06-13T00:00:00.000Z');
    expect(checkNeedsRefresh(ts, '2026-06-13T00:00:00.000Z')).toBe('current');
  });

  it('returns current when local is newer than remote', () => {
    const local = Date.parse('2026-06-20T00:00:00.000Z');
    expect(checkNeedsRefresh(local, '2026-06-13T00:00:00.000Z')).toBe('current');
  });

  it('returns current when remoteUpdatedAt is an unparseable string', () => {
    const local = Date.parse('2026-06-01T00:00:00.000Z');
    expect(checkNeedsRefresh(local, 'not-a-date')).toBe('current');
  });

  it('returns needs-refresh when local is null and remoteUpdatedAt is unparseable', () => {
    // Null local always means we need to refresh (no existing data)
    expect(checkNeedsRefresh(null, 'not-a-date')).toBe('needs-refresh');
  });
});
