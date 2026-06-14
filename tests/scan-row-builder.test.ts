import { describe, it, expect } from 'vitest';
import { buildScanRow } from '../src/main/scan-row-builder.js';

describe('buildScanRow', () => {
  it('sets card_id to null', () => {
    const row = buildScanRow({ thumbnailPath: '/tmp/a.jpg', capturedAt: 1000 });
    expect(row.card_id).toBeNull();
  });

  it('copies thumbnailPath and capturedAt from input', () => {
    const row = buildScanRow({ thumbnailPath: '/scans/thumbnails/123.jpg', capturedAt: 1718000000000 });
    expect(row.thumbnail_path).toBe('/scans/thumbnails/123.jpg');
    expect(row.captured_at).toBe(1718000000000);
  });

  it('leaves recognition fields null', () => {
    const row = buildScanRow({ thumbnailPath: '/tmp/a.jpg', capturedAt: 1000 });
    expect(row.phash).toBeNull();
    expect(row.confidence_score).toBeNull();
    expect(row.inferences_json).toBeNull();
  });

  it('sets needed_manual_review to 0', () => {
    const row = buildScanRow({ thumbnailPath: '/tmp/a.jpg', capturedAt: 1000 });
    expect(row.needed_manual_review).toBe(0);
  });
});
