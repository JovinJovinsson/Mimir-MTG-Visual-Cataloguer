import { describe, it, expect } from 'vitest';
import { computePHash, hammingDistance } from '../src/main/phash.js';

function makeSolid(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function makeCheckerboard(width: number, height: number, cell: number): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
      const v = on ? 240 : 16;
      const i = (y * width + x) * 4;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function makeGradient(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.floor((x * 255) / Math.max(1, width - 1));
      const i = (y * width + x) * 4;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

describe('computePHash', () => {
  it('returns a fixed-length hex string (16 chars = 64 bits)', () => {
    const img = makeCheckerboard(64, 64, 8);
    const hash = computePHash(img, 64, 64);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same input', () => {
    const img = makeCheckerboard(64, 64, 8);
    expect(computePHash(img, 64, 64)).toBe(computePHash(img, 64, 64));
  });

  it('produces different hashes for visually different images', () => {
    const checker = makeCheckerboard(64, 64, 8);
    const gradient = makeGradient(64, 64);
    expect(computePHash(checker, 64, 64)).not.toBe(computePHash(gradient, 64, 64));
  });

  it('produces a similar hash for the same image at a different size', () => {
    const small = makeCheckerboard(64, 64, 8);
    const large = makeCheckerboard(128, 128, 16);
    const a = computePHash(small, 64, 64);
    const b = computePHash(large, 128, 128);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(10);
  });

  it('produces a distant hash for unrelated images', () => {
    const checker = makeCheckerboard(64, 64, 8);
    const gradient = makeGradient(64, 64);
    expect(hammingDistance(computePHash(checker, 64, 64), computePHash(gradient, 64, 64)))
      .toBeGreaterThan(10);
  });

  it('handles solid-color images without throwing', () => {
    const img = makeSolid(64, 64, 200, 50, 50);
    const hash = computePHash(img, 64, 64);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance('abc123', 'abc123')).toBe(0);
  });

  it('counts differing bits', () => {
    // 0xf = 1111, 0x0 = 0000 → 4 differing bits
    expect(hammingDistance('f', '0')).toBe(4);
    // 0xa = 1010, 0x5 = 0101 → 4 differing bits
    expect(hammingDistance('a', '5')).toBe(4);
  });

  it('throws on mismatched lengths', () => {
    expect(() => hammingDistance('abc', 'abcd')).toThrow();
  });
});
