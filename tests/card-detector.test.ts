import { describe, it, expect } from 'vitest';
import {
  initState,
  step,
  quadIoU,
  type Quad,
  type FrameInput,
  type CaptureEvent,
} from '../src/renderer/card-detector.js';

const Q1: Quad = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 400 },
  { x: 100, y: 400 },
];

// Slightly shifted version of Q1 — IoU ≈ 0.91 (stable)
const Q1_STABLE: Quad = [
  { x: 105, y: 105 },
  { x: 305, y: 105 },
  { x: 305, y: 405 },
  { x: 105, y: 405 },
];

// Jittered version of Q1 — IoU ≈ 0.6 (unstable)
const Q1_JITTER: Quad = [
  { x: 150, y: 130 },
  { x: 350, y: 130 },
  { x: 350, y: 430 },
  { x: 150, y: 430 },
];

// Completely different quad — IoU ≈ 0 (different card)
const Q2: Quad = [
  { x: 400, y: 10 },
  { x: 600, y: 10 },
  { x: 600, y: 310 },
  { x: 400, y: 310 },
];

function feed(frames: FrameInput[]): CaptureEvent[] {
  let state = initState();
  const events: CaptureEvent[] = [];
  for (const frame of frames) {
    const result = step(state, frame);
    state = result.state;
    events.push(...result.events);
  }
  return events;
}

function stableFrames(quad: Quad, totalMs: number, fps = 30): FrameInput[] {
  const deltaMs = 1000 / fps;
  const count = Math.ceil(totalMs / deltaMs);
  return Array.from({ length: count }, () => ({ quad, deltaMs }));
}

function absentFrames(totalMs: number, fps = 30): FrameInput[] {
  const deltaMs = 1000 / fps;
  const count = Math.ceil(totalMs / deltaMs);
  return Array.from({ length: count }, () => ({ quad: null, deltaMs }));
}

describe('quadIoU', () => {
  it('returns 1 for identical quads', () => {
    expect(quadIoU(Q1, Q1)).toBeCloseTo(1.0);
  });

  it('returns 0 for non-overlapping quads', () => {
    expect(quadIoU(Q1, Q2)).toBe(0);
  });

  it('returns high value for slightly shifted quads', () => {
    const iou = quadIoU(Q1, Q1_STABLE);
    expect(iou).toBeGreaterThan(0.85);
  });

  it('returns mid value for jittered quads', () => {
    const iou = quadIoU(Q1, Q1_JITTER);
    expect(iou).toBeGreaterThan(0.3);
    expect(iou).toBeLessThan(0.85);
  });
});

describe('initState', () => {
  it('starts in idle phase', () => {
    expect(initState().phase).toBe('idle');
  });

  it('has null candidate', () => {
    expect(initState().candidate).toBeNull();
  });
});

describe('step — idle phase', () => {
  it('stays idle when no quad detected', () => {
    const { state } = step(initState(), { quad: null, deltaMs: 16 });
    expect(state.phase).toBe('idle');
  });

  it('transitions to detecting when quad appears', () => {
    const { state } = step(initState(), { quad: Q1, deltaMs: 16 });
    expect(state.phase).toBe('detecting');
    expect(state.stableMs).toBe(0);
  });

  it('emits no events in idle', () => {
    const { events } = step(initState(), { quad: Q1, deltaMs: 16 });
    expect(events).toHaveLength(0);
  });
});

describe('step — detecting phase', () => {
  it('resets to idle when quad disappears', () => {
    let { state } = step(initState(), { quad: Q1, deltaMs: 16 });
    ({ state } = step(state, { quad: null, deltaMs: 16 }));
    expect(state.phase).toBe('idle');
  });

  it('accumulates stableMs when quad is stable', () => {
    let { state } = step(initState(), { quad: Q1, deltaMs: 16 });
    ({ state } = step(state, { quad: Q1_STABLE, deltaMs: 100 }));
    expect(state.phase).toBe('detecting');
    expect(state.stableMs).toBeGreaterThan(0);
  });

  it('resets stableMs on jitter', () => {
    let state = initState();
    ({ state } = step(state, { quad: Q1, deltaMs: 16 }));
    ({ state } = step(state, { quad: Q1_STABLE, deltaMs: 100 }));
    expect(state.stableMs).toBeGreaterThan(0);
    ({ state } = step(state, { quad: Q1_JITTER, deltaMs: 16 }));
    expect(state.stableMs).toBe(0);
  });
});

describe('scripted sequence: stable → capture', () => {
  it('fires exactly 1 capture after 500ms of stability', () => {
    const events = feed(stableFrames(Q1, 500));
    expect(events.filter((e) => e.kind === 'capture')).toHaveLength(1);
  });

  it('does not fire before stability threshold (200ms)', () => {
    const events = feed(stableFrames(Q1, 200));
    expect(events.filter((e) => e.kind === 'capture')).toHaveLength(0);
  });

  it('captured quad matches detected quad', () => {
    const events = feed(stableFrames(Q1, 500));
    expect(events[0]?.kind).toBe('capture');
  });
});

describe('scripted sequence: leave-frame-before-next', () => {
  it('allows a second capture after card leaves frame for 400ms', () => {
    const events = feed([
      ...stableFrames(Q1, 500),  // first capture
      ...absentFrames(400),       // card leaves (> LEAVE_MS=300)
      ...stableFrames(Q1, 500),  // second capture
    ]);
    const captures = events.filter((e) => e.kind === 'capture');
    expect(captures).toHaveLength(2);
  });

  it('does not allow second capture if absence is too short (100ms)', () => {
    const events = feed([
      ...stableFrames(Q1, 500),  // first capture
      ...absentFrames(100),       // card leaves but < LEAVE_MS
      ...stableFrames(Q1, 500),  // should NOT capture again — card came back during cooldown
    ]);
    const captures = events.filter((e) => e.kind === 'capture');
    expect(captures).toHaveLength(1);
  });
});

describe('scripted sequence: no-second-before-leave', () => {
  it('fires only 1 capture even after 800ms with same card in frame', () => {
    const events = feed([
      ...stableFrames(Q1, 500),  // first capture
      ...stableFrames(Q1, 800),  // card stays — no second capture
    ]);
    const captures = events.filter((e) => e.kind === 'capture');
    expect(captures).toHaveLength(1);
  });
});

describe('scripted sequence: jitter only', () => {
  it('does not capture when quad constantly jitters (IoU ~0.6)', () => {
    const frames: FrameInput[] = [];
    for (let i = 0; i < 60; i++) {
      frames.push({ quad: i % 2 === 0 ? Q1 : Q1_JITTER, deltaMs: 16 });
    }
    const events = feed(frames);
    expect(events.filter((e) => e.kind === 'capture')).toHaveLength(0);
  });
});

describe('scripted sequence: two-card simultaneous', () => {
  it('does not capture when two very different quads alternate every frame', () => {
    const frames: FrameInput[] = [];
    for (let i = 0; i < 60; i++) {
      frames.push({ quad: i % 2 === 0 ? Q1 : Q2, deltaMs: 16 });
    }
    const events = feed(frames);
    expect(events.filter((e) => e.kind === 'capture')).toHaveLength(0);
  });
});

describe('scripted sequence: different card triggers new capture', () => {
  it('transitions directly to detecting on substantially different quad during cooldown', () => {
    // First capture with Q1
    let state = initState();
    const allEvents: CaptureEvent[] = [];
    for (const frame of stableFrames(Q1, 500)) {
      const r = step(state, frame);
      state = r.state;
      allEvents.push(...r.events);
    }
    expect(state.phase).toBe('cooldown');

    // Immediately present Q2 (different card) — should flip to detecting
    const { state: nextState } = step(state, { quad: Q2, deltaMs: 16 });
    expect(nextState.phase).toBe('detecting');
  });
});
