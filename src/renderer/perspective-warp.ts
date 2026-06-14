export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

export const CARD_WIDTH = 400;
export const CARD_HEIGHT = 559; // 88/63 * 400 ≈ 558.7

// Solve Ax = b via Gaussian elimination with partial pivoting (8×8).
function solveLinear8(A: number[][], b: number[]): number[] {
  const n = 8;
  const aug: number[][] = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row]![col]!);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow]!, aug[col]!];

    const pivot = aug[col]![col]!;
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row]![col]! / pivot;
      for (let k = col; k <= n; k++) {
        aug[row]![k] = aug[row]![k]! - factor * aug[col]![k]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row]![n]!;
    for (let col = row + 1; col < n; col++) {
      sum -= aug[row]![col]! * x[col]!;
    }
    x[row] = aug[row]![row]! !== 0 ? sum / aug[row]![row]! : 0;
  }
  return x;
}

// Compute the 3x3 homography H (as 9-element flat array, row-major) that maps
// srcQuad corners → dstQuad corners.
function computeHomography(src: Quad, dst: Quad): number[] {
  const [s0, s1, s2, s3] = src;
  const [d0, d1, d2, d3] = dst;
  const pairs: [Point, Point][] = [[s0, d0], [s1, d1], [s2, d2], [s3, d3]];
  const A: number[][] = [];
  const b: number[] = [];
  for (const [s, d] of pairs) {
    const sx = s.x, sy = s.y, dx = d.x, dy = d.y;
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  const h = solveLinear8(A, b);
  return [...h, 1]; // h[8] = h22 = 1
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Apply homography H (9-element, row-major) to a 2-D point.
function applyH(H: number[], x: number, y: number): [number, number] {
  const w = H[6]! * x + H[7]! * y + H[8]!;
  const px = (H[0]! * x + H[1]! * y + H[2]!) / w;
  const py = (H[3]! * x + H[4]! * y + H[5]!) / w;
  return [px, py];
}

// Sample pixel channel from source buffer with bilinear interpolation.
function sampleBilinear(
  pixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
  c: number,
): number {
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = x0 + 1, y1 = y0 + 1;
  const fx = sx - x0, fy = sy - y0;

  function px(x: number, y: number): number {
    const cx = clamp(x, 0, srcW - 1);
    const cy = clamp(y, 0, srcH - 1);
    return pixels[(cy * srcW + cx) * 4 + c]!;
  }

  const p00 = px(x0, y0), p10 = px(x1, y0);
  const p01 = px(x0, y1), p11 = px(x1, y1);
  return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy)
       + p01 * (1 - fx) * fy       + p11 * fx * fy;
}

/**
 * Perspective-warp the region of srcPixels bounded by srcQuad into a
 * dstWidth×dstHeight RGBA buffer. Defaults to standard MTG card size.
 *
 * srcQuad corners: [TL, TR, BR, BL]
 */
export function warpCard(
  srcPixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  srcQuad: Quad,
  dstWidth = CARD_WIDTH,
  dstHeight = CARD_HEIGHT,
): Uint8ClampedArray {
  const dstQuad: Quad = [
    { x: 0, y: 0 },
    { x: dstWidth - 1, y: 0 },
    { x: dstWidth - 1, y: dstHeight - 1 },
    { x: 0, y: dstHeight - 1 },
  ];

  // H maps dst → src (inverse mapping for each destination pixel)
  const H_inv = computeHomography(dstQuad, srcQuad);

  const dst = new Uint8ClampedArray(dstWidth * dstHeight * 4);

  for (let dy = 0; dy < dstHeight; dy++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      const [sx, sy] = applyH(H_inv, dx, dy);
      const base = (dy * dstWidth + dx) * 4;
      dst[base] = sampleBilinear(srcPixels, srcWidth, srcHeight, sx, sy, 0);
      dst[base + 1] = sampleBilinear(srcPixels, srcWidth, srcHeight, sx, sy, 1);
      dst[base + 2] = sampleBilinear(srcPixels, srcWidth, srcHeight, sx, sy, 2);
      dst[base + 3] = sampleBilinear(srcPixels, srcWidth, srcHeight, sx, sy, 3);
    }
  }

  return dst;
}
