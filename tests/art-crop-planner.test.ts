import { describe, it, expect } from 'vitest';
import {
  planSetCropDownload,
  estimateDiskUsageBytes,
  type SetCropCardRow,
} from '../src/main/art-crop-planner.js';

function card(id: string, opts: Partial<SetCropCardRow> = {}): SetCropCardRow {
  return {
    scryfall_id: id,
    image_art_crop_url:
      'image_art_crop_url' in opts ? opts.image_art_crop_url ?? null : `https://img/${id}.jpg`,
    phash: opts.phash ?? null,
    art_crop_path: opts.art_crop_path ?? null,
  };
}

describe('planSetCropDownload', () => {
  it('queues every card with an art-crop URL but no phash yet', () => {
    const plan = planSetCropDownload('lea', [card('a'), card('b'), card('c')]);
    expect(plan.kind).toBe('download');
    if (plan.kind !== 'download') return;
    expect(plan.setCode).toBe('lea');
    expect(plan.cards.map((c) => c.scryfall_id)).toEqual(['a', 'b', 'c']);
    expect(plan.totalCards).toBe(3);
    expect(plan.alreadyHashed).toBe(0);
  });

  it('skips cards that already have phash + art_crop_path', () => {
    const plan = planSetCropDownload('lea', [
      card('a', { phash: 'deadbeefdeadbeef', art_crop_path: '/x/lea/a.jpg' }),
      card('b'),
    ]);
    expect(plan.kind).toBe('download');
    if (plan.kind !== 'download') return;
    expect(plan.cards.map((c) => c.scryfall_id)).toEqual(['b']);
    expect(plan.totalCards).toBe(2);
    expect(plan.alreadyHashed).toBe(1);
  });

  it('skips cards without an art-crop URL (no source to fetch)', () => {
    const plan = planSetCropDownload('lea', [
      card('a', { image_art_crop_url: null }),
      card('b'),
    ]);
    expect(plan.kind).toBe('download');
    if (plan.kind !== 'download') return;
    expect(plan.cards.map((c) => c.scryfall_id)).toEqual(['b']);
    expect(plan.skippedNoUrl).toBe(1);
  });

  it('returns "complete" when every card is already hashed', () => {
    const plan = planSetCropDownload('lea', [
      card('a', { phash: 'h1', art_crop_path: '/x/a.jpg' }),
      card('b', { phash: 'h2', art_crop_path: '/x/b.jpg' }),
    ]);
    expect(plan.kind).toBe('complete');
  });

  it('returns "empty" when the set has no cards', () => {
    const plan = planSetCropDownload('emptyset', []);
    expect(plan.kind).toBe('empty');
  });

  it('returns "complete" when the set has only cards with no art-crop URL and no phash needed', () => {
    // No URL and no hash means there's nothing to download; treat as complete.
    const plan = planSetCropDownload('lea', [
      card('a', { image_art_crop_url: null }),
    ]);
    expect(plan.kind).toBe('complete');
  });
});

describe('estimateDiskUsageBytes', () => {
  it('estimates roughly 30 KB per card', () => {
    expect(estimateDiskUsageBytes(0)).toBe(0);
    expect(estimateDiskUsageBytes(100)).toBe(100 * 30_000);
    expect(estimateDiskUsageBytes(1000)).toBe(1000 * 30_000);
  });
});
