import { describe, it, expect } from 'vitest';
import { updateReducer, type UpdateState, type UpdateAction } from '../src/main/update-reducer.js';

const idle: UpdateState = { phase: 'idle' };
const checking: UpdateState = { phase: 'checking' };
const upToDate: UpdateState = { phase: 'up-to-date' };
const available: UpdateState = { phase: 'available', version: '1.1.0', releaseNotes: 'Bug fixes' };
const downloading: UpdateState = { phase: 'downloading', percent: 50, bytesPerSecond: 1000, transferred: 500, total: 1000 };
const ready: UpdateState = { phase: 'ready', version: '1.1.0' };
const dismissed: UpdateState = { phase: 'dismissed' };

function dispatch(state: UpdateState, action: UpdateAction): UpdateState {
  return updateReducer(state, action);
}

describe('updateReducer — CHECK_STARTED', () => {
  it('transitions idle → checking', () => {
    expect(dispatch(idle, { type: 'CHECK_STARTED' })).toEqual({ phase: 'checking' });
  });

  it('transitions dismissed → checking', () => {
    expect(dispatch(dismissed, { type: 'CHECK_STARTED' })).toEqual({ phase: 'checking' });
  });

  it('ignores when downloading', () => {
    expect(dispatch(downloading, { type: 'CHECK_STARTED' })).toBe(downloading);
  });

  it('ignores when ready', () => {
    expect(dispatch(ready, { type: 'CHECK_STARTED' })).toBe(ready);
  });
});

describe('updateReducer — UPDATE_AVAILABLE', () => {
  it('transitions checking → available with version and release notes', () => {
    const result = dispatch(checking, { type: 'UPDATE_AVAILABLE', version: '1.1.0', releaseNotes: 'Bug fixes' });
    expect(result).toEqual({ phase: 'available', version: '1.1.0', releaseNotes: 'Bug fixes' });
  });

  it('accepts null release notes', () => {
    const result = dispatch(checking, { type: 'UPDATE_AVAILABLE', version: '1.1.0', releaseNotes: null });
    expect(result).toEqual({ phase: 'available', version: '1.1.0', releaseNotes: null });
  });

  it('ignores when not checking', () => {
    expect(dispatch(idle, { type: 'UPDATE_AVAILABLE', version: '1.1.0', releaseNotes: null })).toBe(idle);
    expect(dispatch(available, { type: 'UPDATE_AVAILABLE', version: '1.1.0', releaseNotes: null })).toBe(available);
  });
});

describe('updateReducer — UP_TO_DATE', () => {
  it('transitions checking → up-to-date', () => {
    expect(dispatch(checking, { type: 'UP_TO_DATE' })).toEqual({ phase: 'up-to-date' });
  });

  it('ignores when not checking', () => {
    expect(dispatch(idle, { type: 'UP_TO_DATE' })).toBe(idle);
    expect(dispatch(available, { type: 'UP_TO_DATE' })).toBe(available);
  });
});

describe('updateReducer — DOWNLOAD_PROGRESS', () => {
  const progress: UpdateAction = { type: 'DOWNLOAD_PROGRESS', percent: 75, bytesPerSecond: 2000, transferred: 750, total: 1000 };

  it('transitions available → downloading', () => {
    expect(dispatch(available, progress)).toEqual({ phase: 'downloading', percent: 75, bytesPerSecond: 2000, transferred: 750, total: 1000 });
  });

  it('updates progress when already downloading', () => {
    const next = dispatch(downloading, progress);
    expect(next).toEqual({ phase: 'downloading', percent: 75, bytesPerSecond: 2000, transferred: 750, total: 1000 });
  });

  it('ignores when not available or downloading', () => {
    expect(dispatch(idle, progress)).toBe(idle);
    expect(dispatch(checking, progress)).toBe(checking);
    expect(dispatch(ready, progress)).toBe(ready);
  });
});

describe('updateReducer — DOWNLOAD_COMPLETE', () => {
  it('transitions downloading → ready', () => {
    expect(dispatch(downloading, { type: 'DOWNLOAD_COMPLETE', version: '1.1.0' })).toEqual({ phase: 'ready', version: '1.1.0' });
  });

  it('ignores when not downloading', () => {
    expect(dispatch(available, { type: 'DOWNLOAD_COMPLETE', version: '1.1.0' })).toBe(available);
    expect(dispatch(idle, { type: 'DOWNLOAD_COMPLETE', version: '1.1.0' })).toBe(idle);
  });
});

describe('updateReducer — ERROR', () => {
  it('transitions any state → error', () => {
    for (const state of [idle, checking, available, downloading, ready, dismissed]) {
      expect(dispatch(state, { type: 'ERROR', message: 'Network failure' })).toEqual({ phase: 'error', message: 'Network failure' });
    }
  });
});

describe('updateReducer — DISMISS', () => {
  it('transitions available → dismissed', () => {
    expect(dispatch(available, { type: 'DISMISS' })).toEqual({ phase: 'dismissed' });
  });

  it('transitions ready → dismissed', () => {
    expect(dispatch(ready, { type: 'DISMISS' })).toEqual({ phase: 'dismissed' });
  });

  it('transitions up-to-date → dismissed', () => {
    expect(dispatch(upToDate, { type: 'DISMISS' })).toEqual({ phase: 'dismissed' });
  });

  it('transitions error → dismissed', () => {
    const error: UpdateState = { phase: 'error', message: 'oops' };
    expect(dispatch(error, { type: 'DISMISS' })).toEqual({ phase: 'dismissed' });
  });

  it('ignores when downloading', () => {
    expect(dispatch(downloading, { type: 'DISMISS' })).toBe(downloading);
  });
});

describe('updateReducer — INSTALL_NOW', () => {
  it('transitions ready → idle', () => {
    expect(dispatch(ready, { type: 'INSTALL_NOW' })).toEqual({ phase: 'idle' });
  });

  it('ignores when not ready', () => {
    expect(dispatch(idle, { type: 'INSTALL_NOW' })).toBe(idle);
    expect(dispatch(downloading, { type: 'INSTALL_NOW' })).toBe(downloading);
    expect(dispatch(available, { type: 'INSTALL_NOW' })).toBe(available);
  });
});
