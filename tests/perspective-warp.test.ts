import { describe, it, expect } from 'vitest';
import { warpCard, CARD_WIDTH, CARD_HEIGHT, type Quad } from '../src/renderer/perspective-warp.js';

function solidImage(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function checkerImage(w: number, h: number, cell: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
      const v = on ? 220 : 30;
      const i = (y * w + x) * 4;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

describe('CARD_WIDTH / CARD_HEIGHT', () => {
  it('exports standard card dimensions', () => {
    expect(CARD_WIDTH).toBe(400);
    expect(CARD_HEIGHT).toBe(559);
  });
});

describe('warpCard output size', () => {
  it('returns exactly dstWidth*dstHeight*4 bytes by default', () => {
    const src = solidImage(100, 100, 128, 64, 32);
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 99, y: 0 },
      { x: 99, y: 99 },
      { x: 0, y: 99 },
    ];
    const out = warpCard(src, 100, 100, quad);
    expect(out.byteLength).toBe(CARD_WIDTH * CARD_HEIGHT * 4);
  });

  it('returns exactly custom dstWidth*dstHeight*4 bytes', () => {
    const src = solidImage(200, 200, 0, 0, 0);
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 199, y: 0 },
      { x: 199, y: 199 },
      { x: 0, y: 199 },
    ];
    const out = warpCard(src, 200, 200, quad, 100, 150);
    expect(out.byteLength).toBe(100 * 150 * 4);
  });
});

describe('warpCard identity quad', () => {
  it('preserves solid color when quad is exactly the destination rect', () => {
    const W = 80, H = 100;
    const src = solidImage(W, H, 200, 100, 50);
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: W - 1, y: 0 },
      { x: W - 1, y: H - 1 },
      { x: 0, y: H - 1 },
    ];
    const out = warpCard(src, W, H, quad, W, H);
    // Sample centre pixel
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const idx = (cy * W + cx) * 4;
    expect(out[idx]).toBeCloseTo(200, -1);
    expect(out[idx + 1]).toBeCloseTo(100, -1);
    expect(out[idx + 2]).toBeCloseTo(50, -1);
  });
});

describe('warpCard full-frame rect', () => {
  it('produces output with correct dimensions when quad covers entire source', () => {
    const srcW = 640, srcH = 480;
    const src = solidImage(srcW, srcH, 120, 80, 40);
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: srcW - 1, y: 0 },
      { x: srcW - 1, y: srcH - 1 },
      { x: 0, y: srcH - 1 },
    ];
    const out = warpCard(src, srcW, srcH, quad, 200, 140);
    expect(out.byteLength).toBe(200 * 140 * 4);
    // Centre pixel should approximate the source colour
    const cx = 100, cy = 70;
    const idx = (cy * 200 + cx) * 4;
    expect(out[idx]).toBeCloseTo(120, -1);
    expect(out[idx + 1]).toBeCloseTo(80, -1);
    expect(out[idx + 2]).toBeCloseTo(40, -1);
  });
});

describe('warpCard checkerboard', () => {
  it('produces output of the right size and non-uniform pixel values', () => {
    const W = 200, H = 200;
    const src = checkerImage(W, H, 20);
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: W - 1, y: 0 },
      { x: W - 1, y: H - 1 },
      { x: 0, y: H - 1 },
    ];
    const out = warpCard(src, W, H, quad, 100, 100);
    expect(out.byteLength).toBe(100 * 100 * 4);

    // Not a uniform image — some pixels should differ
    const firstR = out[0];
    let hasVariation = false;
    for (let i = 0; i < 100 * 100; i++) {
      if (out[i * 4] !== firstR) { hasVariation = true; break; }
    }
    expect(hasVariation).toBe(true);
  });
});
