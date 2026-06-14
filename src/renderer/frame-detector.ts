export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

// ─── Internal helpers ────────────────────────────────────────────────────────

const KERNEL_5 = [1, 4, 6, 4, 1, 4, 16, 24, 16, 4, 6, 24, 36, 24, 6, 4, 16, 24, 16, 4, 1, 4, 6, 4, 1] as const;

function blur5(src: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let sum = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          // Both array accesses are in-bounds by construction
          sum += src[(y + ky) * w + (x + kx)]! * KERNEL_5[(ky + 2) * 5 + (kx + 2)]!;
        }
      }
      dst[y * w + x] = sum / 256;
    }
  }
  return dst;
}

function sobel(src: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      // Indices are in-bounds by loop constraints
      const gx =
        -src[(y - 1) * w + (x - 1)]! - 2 * src[y * w + (x - 1)]! - src[(y + 1) * w + (x - 1)]!
        + src[(y - 1) * w + (x + 1)]! + 2 * src[y * w + (x + 1)]! + src[(y + 1) * w + (x + 1)]!;
      const gy =
        -src[(y - 1) * w + (x - 1)]! - 2 * src[(y - 1) * w + x]! - src[(y - 1) * w + (x + 1)]!
        + src[(y + 1) * w + (x - 1)]! + 2 * src[(y + 1) * w + x]! + src[(y + 1) * w + (x + 1)]!;
      const mag = Math.sqrt(gx * gx + gy * gy);
      dst[y * w + x] = mag > 255 ? 255 : mag;
    }
  }
  return dst;
}

function threshold(src: Uint8Array, n: number, t: number): Uint8Array {
  const dst = new Uint8Array(n);
  for (let i = 0; i < n; i++) dst[i] = src[i]! >= t ? 255 : 0;
  return dst;
}

function dilate3(src: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (
        src[(y - 1) * w + x]! || src[(y + 1) * w + x]! ||
        src[y * w + (x - 1)]! || src[y * w + (x + 1)]! || src[y * w + x]!
      ) {
        dst[y * w + x] = 255;
      }
    }
  }
  return dst;
}

// BFS flood fill — returns all pixels of one connected component.
function bfs(binary: Uint8Array, w: number, h: number, start: number, visited: Uint8Array): Point[] {
  const component: Point[] = [];
  const queue = [start];
  visited[start] = 1;
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % w, y = Math.floor(idx / w);
    component.push({ x, y });
    for (const n of [idx - 1, idx + 1, idx - w, idx + w]) {
      if (n >= 0 && n < w * h && binary[n]! === 255 && !visited[n]!) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  return component;
}

// Graham scan convex hull. Returns points in CCW order.
function convexHull(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function perimeter(pts: Point[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

// Ramer-Douglas-Peucker simplification.
function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length <= 2) return pts;
  let maxDist = 0, maxIdx = 0;
  const { x: x1, y: y1 } = pts[0]!;
  const last = pts[pts.length - 1]!;
  const { x: x2, y: y2 } = last;
  const lineLen = Math.hypot(x2 - x1, y2 - y1);
  for (let i = 1; i < pts.length - 1; i++) {
    const { x, y } = pts[i]!;
    const dist = lineLen < 1e-9
      ? Math.hypot(x - x1, y - y1)
      : Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / lineLen;
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > eps) {
    const left = rdp(pts.slice(0, maxIdx + 1), eps);
    const right = rdp(pts.slice(maxIdx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [pts[0]!, pts[pts.length - 1]!];
}

// Approximate closed polygon (hull) with epsilon = fraction of perimeter.
function approxPoly(hull: Point[], epsFraction = 0.02): Point[] {
  if (hull.length < 3) return hull;
  const eps = perimeter(hull) * epsFraction;
  const closed = [...hull, hull[0]!];
  const simplified = rdp(closed, eps);
  const first = simplified[0]!, last2 = simplified[simplified.length - 1]!;
  if (simplified.length > 1 && first.x === last2.x && first.y === last2.y) {
    simplified.pop();
  }
  return simplified;
}

function polyArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

// Sort quad corners into TL, TR, BR, BL order.
function orderQuad(pts: Point[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const tl = pts.filter((p) => p.x <= cx && p.y <= cy).sort((a, b) => a.x + a.y - b.x - b.y)[0];
  const tr = pts.filter((p) => p.x > cx && p.y <= cy).sort((a, b) => b.x - a.x)[0];
  const br = pts.filter((p) => p.x > cx && p.y > cy).sort((a, b) => b.x + b.y - a.x - a.y)[0];
  const bl = pts.filter((p) => p.x <= cx && p.y > cy).sort((a, b) => a.x - b.x)[0];

  if (!tl || !tr || !br || !bl) {
    // Fallback: sort by angle from centroid
    const byAngle = [...pts].sort(
      (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
    );
    // Guarantee we return a proper Quad (4 elements)
    const p0 = byAngle[0] ?? { x: 0, y: 0 };
    const p1 = byAngle[1] ?? { x: 0, y: 0 };
    const p2 = byAngle[2] ?? { x: 0, y: 0 };
    const p3 = byAngle[3] ?? { x: 0, y: 0 };
    return [p0, p1, p2, p3];
  }
  return [tl, tr, br, bl];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect the largest card-shaped quadrilateral in an RGBA video frame.
 * Returns TL, TR, BR, BL corners in original frame coordinates, or null.
 */
export function detectCard(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Quad | null {
  const SCALE = 0.5;
  const sw = Math.max(1, Math.round(width * SCALE));
  const sh = Math.max(1, Math.round(height * SCALE));

  // Downsample + grayscale
  const gray = new Uint8Array(sw * sh);
  for (let dy = 0; dy < sh; dy++) {
    for (let dx = 0; dx < sw; dx++) {
      const sy = Math.min(Math.round(dy / SCALE), height - 1);
      const sx = Math.min(Math.round(dx / SCALE), width - 1);
      const base = (sy * width + sx) * 4;
      gray[dy * sw + dx] = (pixels[base]! * 77 + pixels[base + 1]! * 150 + pixels[base + 2]! * 29) >> 8;
    }
  }

  const blurred = blur5(gray, sw, sh);
  const edges = sobel(blurred, sw, sh);
  // Higher threshold: only strong edges (card borders) fire.
  // 45 eliminates most background gradients without losing card outlines.
  const binary = threshold(edges, sw * sh, 45);
  const dilated = dilate3(binary, sw, sh);

  const frameArea = sw * sh;
  // Card must occupy 4–75% of the (half-res) frame area to be plausible.
  const MIN_AREA = frameArea * 0.04;
  const MAX_AREA = frameArea * 0.75;
  // Minimum edge-pixel count per component: a card border at this scale
  // needs at least ~300 edge pixels to form a detectable closed rectangle.
  const MIN_COMPONENT = 300;

  const visited = new Uint8Array(sw * sh);
  let bestQuad: Quad | null = null;
  let bestArea = 0;

  for (let i = 0; i < sw * sh; i++) {
    if (dilated[i]! === 255 && !visited[i]!) {
      const comp = bfs(dilated, sw, sh, i, visited);
      if (comp.length < MIN_COMPONENT) continue;

      const hull = convexHull(comp);
      if (hull.length < 4) continue;

      const poly = approxPoly(hull, 0.025);
      if (poly.length !== 4) continue;

      const area = polyArea(poly);
      // Reject quads that are too small (noise) or too large (entire frame).
      if (area < MIN_AREA || area > MAX_AREA) continue;

      // MTG card aspect ratio: 63×88mm ≈ 0.716:1. Allow perspective distortion
      // up to ~45° which compresses one axis by ~0.7×, giving ~0.5:1 – 1.85:1.
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      const bw = Math.max(...xs) - Math.min(...xs);
      const bh = Math.max(...ys) - Math.min(...ys);
      const ar = bh > 0 ? bw / bh : 0;
      if (ar < 0.5 || ar > 1.85) continue;

      if (area > bestArea) {
        bestArea = area;
        bestQuad = orderQuad(poly);
      }
    }
  }

  if (!bestQuad) return null;

  const invScale = 1 / SCALE;
  return bestQuad.map((p) => ({ x: p.x * invScale, y: p.y * invScale })) as Quad;
}
