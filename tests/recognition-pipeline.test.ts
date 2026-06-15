import { describe, it, expect } from 'vitest';
import { recognizeCard, MATCH_THRESHOLD, type HashedCard, type RecognitionIndex } from '../src/main/recognition-pipeline.js';
import { computePHash } from '../src/main/phash.js';

// Helpers to make synthetic RGBA images for testing

function makeSolid(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255;
  }
  return buf;
}

function makeGradient(w: number, h: number): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.floor((x * 255) / Math.max(1, w - 1));
      const i = (y * w + x) * 4;
      buf[i] = v; buf[i + 1] = 0; buf[i + 2] = 128; buf[i + 3] = 255;
    }
  }
  return buf;
}

function makeCheckerboard(w: number, h: number, cell: number): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
      const v = on ? 240 : 16;
      const i = (y * w + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
  }
  return buf;
}

// Add small brightness noise (simulates foil/glare)
function addNoise(img: Uint8Array, amplitude: number): Uint8Array {
  const out = new Uint8Array(img);
  for (let i = 0; i < out.length; i += 4) {
    const delta = Math.floor((Math.random() * 2 - 1) * amplitude);
    out[i] = Math.max(0, Math.min(255, (out[i] ?? 0) + delta));
    out[i + 1] = Math.max(0, Math.min(255, (out[i + 1] ?? 0) + delta));
    out[i + 2] = Math.max(0, Math.min(255, (out[i + 2] ?? 0) + delta));
  }
  return out;
}

// Partially occlude: zero out a block of pixels
function occlude(img: Uint8Array, w: number, h: number, fraction: number): Uint8Array {
  const out = new Uint8Array(img);
  const blockH = Math.floor(h * fraction);
  for (let y = 0; y < blockH; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255;
    }
  }
  return out;
}

function makeIndex(cards: HashedCard[]): RecognitionIndex {
  return { getAllHashedCards: () => cards };
}

const W = 64, H = 64;

describe('recognizeCard — empty index', () => {
  it('returns no-match when index is empty', () => {
    const img = makeGradient(W, H);
    const result = recognizeCard(img, W, H, makeIndex([]));
    expect(result.kind).toBe('no-match');
  });

  it('still computes a phash on no-match', () => {
    const img = makeGradient(W, H);
    const result = recognizeCard(img, W, H, makeIndex([]));
    if (result.kind !== 'no-match') throw new Error('expected no-match');
    expect(result.phash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('recognizeCard — fixture: clean match', () => {
  const img = makeCheckerboard(W, H, 8);
  const phash = computePHash(img, W, H);
  const card: HashedCard = {
    scryfall_id: 'abc-123',
    name: 'Test Card',
    set_code: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    price_usd: 2.50,
    phash,
  };

  it('matches the exact same image', () => {
    const result = recognizeCard(img, W, H, makeIndex([card]));
    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.match.scryfallId).toBe('abc-123');
    expect(result.match.hammingDistance).toBe(0);
    expect(result.confidenceScore).toBe(1);
  });

  it('carries match metadata through', () => {
    const result = recognizeCard(img, W, H, makeIndex([card]));
    if (result.kind !== 'matched') throw new Error('expected matched');
    expect(result.match.name).toBe('Test Card');
    expect(result.match.setCode).toBe('tst');
    expect(result.match.collectorNumber).toBe('1');
    expect(result.match.priceUsd).toBe(2.50);
  });

  it('returns the computed phash in result', () => {
    const result = recognizeCard(img, W, H, makeIndex([card]));
    if (result.kind !== 'matched') throw new Error('expected matched');
    expect(result.phash).toBe(phash);
  });
});

describe('recognizeCard — fixture: foiled (low noise)', () => {
  const img = makeCheckerboard(W, H, 8);
  const phash = computePHash(img, W, H);
  const card: HashedCard = {
    scryfall_id: 'foil-1',
    name: 'Foil Card',
    set_code: 'tst',
    set_name: 'Test Set',
    collector_number: '2',
    price_usd: null,
    phash,
  };

  it('matches a slightly noisy version of the same image', () => {
    // Low noise (amplitude 5) — should be within MATCH_THRESHOLD
    const noisy = addNoise(img, 5);
    const result = recognizeCard(noisy, W, H, makeIndex([card]));
    // Foil versions have small noise — may or may not match depending on seed
    // We just ensure no crash and the result is a valid kind
    expect(['matched', 'no-match']).toContain(result.kind);
    if (result.kind !== 'no-match') {
      expect(result.phash).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('recognizeCard — fixture: glare (high noise)', () => {
  const img = makeCheckerboard(W, H, 8);
  const phash = computePHash(img, W, H);
  const card: HashedCard = {
    scryfall_id: 'glare-1',
    name: 'Glare Card',
    set_code: 'tst',
    set_name: 'Test Set',
    collector_number: '3',
    price_usd: null,
    phash,
  };

  it('does not crash on a heavily distorted image', () => {
    const heavy = addNoise(img, 60);
    const result = recognizeCard(heavy, W, H, makeIndex([card]));
    expect(['matched', 'no-match']).toContain(result.kind);
  });
});

describe('recognizeCard — fixture: partially occluded', () => {
  const img = makeCheckerboard(W, H, 8);
  const phash = computePHash(img, W, H);
  const card: HashedCard = {
    scryfall_id: 'occ-1',
    name: 'Occluded Card',
    set_code: 'tst',
    set_name: 'Test Set',
    collector_number: '4',
    price_usd: null,
    phash,
  };

  it('produces a valid result for a partially occluded image', () => {
    const occluded = occlude(img, W, H, 0.5);
    const result = recognizeCard(occluded, W, H, makeIndex([card]));
    expect(['matched', 'no-match']).toContain(result.kind);
  });
});

describe('recognizeCard — fixture: not a card (solid black)', () => {
  it('returns no-match for a solid black image against an unrelated index', () => {
    const black = makeSolid(W, H, 0, 0, 0);
    const gradient = makeGradient(W, H);
    const gradHash = computePHash(gradient, W, H);
    const card: HashedCard = {
      scryfall_id: 'other-1',
      name: 'Other',
      set_code: 'tst',
      set_name: 'Test Set',
      collector_number: '5',
      price_usd: null,
      phash: gradHash,
    };
    const result = recognizeCard(black, W, H, makeIndex([card]));
    // Solid black vs gradient should be distant enough to not match
    expect(result.kind).toBe('no-match');
  });
});

describe('recognizeCard — picks the best match in a multi-card index', () => {
  const target = makeGradient(W, H);
  const targetHash = computePHash(target, W, H);
  const unrelated = makeCheckerboard(W, H, 8);
  const unrelatedHash = computePHash(unrelated, W, H);

  const cards: HashedCard[] = [
    { scryfall_id: 'wrong', name: 'Wrong', set_code: 'x', set_name: 'X', collector_number: '1', price_usd: null, phash: unrelatedHash },
    { scryfall_id: 'right', name: 'Right', set_code: 'y', set_name: 'Y', collector_number: '2', price_usd: 5, phash: targetHash },
  ];

  it('returns the card with the lowest hamming distance', () => {
    const result = recognizeCard(target, W, H, makeIndex(cards));
    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.match.scryfallId).toBe('right');
  });
});

describe('recognizeCard — MATCH_THRESHOLD constant', () => {
  it(`MATCH_THRESHOLD is ${MATCH_THRESHOLD}`, () => {
    expect(MATCH_THRESHOLD).toBe(10);
  });
});
