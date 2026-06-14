const DCT_SIZE = 32;
const HASH_SIZE = 8;
const HASH_BITS = HASH_SIZE * HASH_SIZE;

export function computePHash(rgba: Uint8Array, width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    throw new Error(`computePHash: invalid dimensions ${width}x${height}`);
  }
  if (rgba.length < width * height * 4) {
    throw new Error(`computePHash: buffer too small for ${width}x${height}`);
  }
  const gray = resizeToGrayscale(rgba, width, height, DCT_SIZE);
  const dct = computeDct2d(gray, DCT_SIZE);
  const coeffs = pickTopLeft(dct, DCT_SIZE, HASH_SIZE);
  const median = medianExcludingDc(coeffs);
  return bitsToHex(coeffs, median);
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`hammingDistance: length mismatch ${a.length} vs ${b.length}`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i] ?? '0', 16);
    const xb = parseInt(b[i] ?? '0', 16);
    if (Number.isNaN(xa) || Number.isNaN(xb)) {
      throw new Error(`hammingDistance: non-hex character at ${i}`);
    }
    let diff = xa ^ xb;
    while (diff !== 0) {
      distance += diff & 1;
      diff >>>= 1;
    }
  }
  return distance;
}

function resizeToGrayscale(
  rgba: Uint8Array,
  width: number,
  height: number,
  target: number,
): Float64Array {
  const out = new Float64Array(target * target);
  const counts = new Uint32Array(target * target);
  // Box-filter downscale: every source pixel votes into the cell it covers.
  for (let sy = 0; sy < height; sy++) {
    const ty = Math.min(target - 1, Math.floor((sy * target) / height));
    for (let sx = 0; sx < width; sx++) {
      const tx = Math.min(target - 1, Math.floor((sx * target) / width));
      const idx = (sy * width + sx) * 4;
      const r = rgba[idx] ?? 0;
      const g = rgba[idx + 1] ?? 0;
      const b = rgba[idx + 2] ?? 0;
      const gray = (r * 299 + g * 587 + b * 114) / 1000;
      const ti = ty * target + tx;
      out[ti] = (out[ti] ?? 0) + gray;
      counts[ti] = (counts[ti] ?? 0) + 1;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const c = counts[i] ?? 0;
    if (c > 0) out[i] = (out[i] ?? 0) / c;
  }
  return out;
}

function buildCosTable(n: number): Float64Array {
  const table = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      table[k * n + i] = Math.cos(((2 * i + 1) * k * Math.PI) / (2 * n));
    }
  }
  return table;
}

function computeDct2d(input: Float64Array, n: number): Float64Array {
  const cos = buildCosTable(n);
  const c0 = 1 / Math.sqrt(n);
  const cK = Math.sqrt(2 / n);
  const rows = new Float64Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let k = 0; k < n; k++) {
      let sum = 0;
      const rowBase = row * n;
      const cosBase = k * n;
      for (let i = 0; i < n; i++) {
        sum += input[rowBase + i]! * cos[cosBase + i]!;
      }
      rows[rowBase + k] = sum * (k === 0 ? c0 : cK);
    }
  }
  const out = new Float64Array(n * n);
  for (let col = 0; col < n; col++) {
    for (let k = 0; k < n; k++) {
      let sum = 0;
      const cosBase = k * n;
      for (let i = 0; i < n; i++) {
        sum += rows[i * n + col]! * cos[cosBase + i]!;
      }
      out[k * n + col] = sum * (k === 0 ? c0 : cK);
    }
  }
  return out;
}

function pickTopLeft(dct: Float64Array, n: number, size: number): Float64Array {
  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = dct[y * n + x]!;
    }
  }
  return out;
}

function medianExcludingDc(coeffs: Float64Array): number {
  const sorted = Array.from(coeffs.slice(1)).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] ?? 0;
}

function bitsToHex(coeffs: Float64Array, median: number): string {
  let hex = '';
  let nibble = 0;
  for (let i = 0; i < HASH_BITS; i++) {
    nibble = (nibble << 1) | ((coeffs[i] ?? 0) > median ? 1 : 0);
    if ((i & 3) === 3) {
      hex += nibble.toString(16);
      nibble = 0;
    }
  }
  return hex;
}
