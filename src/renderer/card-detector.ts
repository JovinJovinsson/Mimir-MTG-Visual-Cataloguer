export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

export interface DetectorState {
  phase: 'idle' | 'detecting' | 'cooldown';
  candidate: Quad | null;
  stableMs: number;
  absentMs: number;
}

export interface FrameInput {
  quad: Quad | null;
  deltaMs: number;
}

export type CaptureEvent = { kind: 'capture'; quad: Quad };
export type StepResult = { state: DetectorState; events: CaptureEvent[] };

const STABILITY_MS = 400;
const STABLE_IOU = 0.85;
const LEAVE_IOU = 0.30;
const LEAVE_MS = 300;

export function initState(): DetectorState {
  return { phase: 'idle', candidate: null, stableMs: 0, absentMs: 0 };
}

function bbox(q: Quad): { x1: number; y1: number; x2: number; y2: number } {
  const [p0, p1, p2, p3] = q;
  const xs = [p0.x, p1.x, p2.x, p3.x];
  const ys = [p0.y, p1.y, p2.y, p3.y];
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

export function quadIoU(a: Quad, b: Quad): number {
  const ba = bbox(a);
  const bb = bbox(b);
  const ix1 = Math.max(ba.x1, bb.x1);
  const iy1 = Math.max(ba.y1, bb.y1);
  const ix2 = Math.min(ba.x2, bb.x2);
  const iy2 = Math.min(ba.y2, bb.y2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const aA = (ba.x2 - ba.x1) * (ba.y2 - ba.y1);
  const bA = (bb.x2 - bb.x1) * (bb.y2 - bb.y1);
  return inter / (aA + bA - inter);
}

export function step(state: DetectorState, frame: FrameInput): StepResult {
  const { quad, deltaMs } = frame;

  switch (state.phase) {
    case 'idle': {
      if (quad == null) return { state, events: [] };
      return {
        state: { phase: 'detecting', candidate: quad, stableMs: 0, absentMs: 0 },
        events: [],
      };
    }

    case 'detecting': {
      if (quad == null) {
        return {
          state: { phase: 'idle', candidate: null, stableMs: 0, absentMs: 0 },
          events: [],
        };
      }
      const iou = quadIoU(state.candidate!, quad);
      if (iou < STABLE_IOU) {
        return {
          state: { phase: 'detecting', candidate: quad, stableMs: 0, absentMs: 0 },
          events: [],
        };
      }
      const newStableMs = state.stableMs + deltaMs;
      if (newStableMs >= STABILITY_MS) {
        return {
          state: { phase: 'cooldown', candidate: quad, stableMs: 0, absentMs: 0 },
          events: [{ kind: 'capture', quad }],
        };
      }
      return {
        state: { phase: 'detecting', candidate: quad, stableMs: newStableMs, absentMs: 0 },
        events: [],
      };
    }

    case 'cooldown': {
      if (quad == null) {
        const newAbsentMs = state.absentMs + deltaMs;
        if (newAbsentMs >= LEAVE_MS) {
          return {
            state: { phase: 'idle', candidate: null, stableMs: 0, absentMs: 0 },
            events: [],
          };
        }
        return { state: { ...state, absentMs: newAbsentMs }, events: [] };
      }
      const iou = quadIoU(state.candidate!, quad);
      if (iou < LEAVE_IOU) {
        return {
          state: { phase: 'detecting', candidate: quad, stableMs: 0, absentMs: 0 },
          events: [],
        };
      }
      return { state: { ...state, absentMs: 0 }, events: [] };
    }
  }
}
