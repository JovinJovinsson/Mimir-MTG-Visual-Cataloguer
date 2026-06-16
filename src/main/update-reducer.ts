export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date' }
  | { phase: 'available'; version: string; releaseNotes: string | null }
  | { phase: 'downloading'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string }
  | { phase: 'dismissed' };

export type UpdateAction =
  | { type: 'CHECK_STARTED' }
  | { type: 'UPDATE_AVAILABLE'; version: string; releaseNotes: string | null }
  | { type: 'UP_TO_DATE' }
  | { type: 'DOWNLOAD_PROGRESS'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { type: 'DOWNLOAD_COMPLETE'; version: string }
  | { type: 'ERROR'; message: string }
  | { type: 'DISMISS' }
  | { type: 'INSTALL_NOW' };

export function updateReducer(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case 'CHECK_STARTED':
      if (state.phase === 'downloading' || state.phase === 'ready') return state;
      return { phase: 'checking' };
    case 'UPDATE_AVAILABLE':
      if (state.phase !== 'checking') return state;
      return { phase: 'available', version: action.version, releaseNotes: action.releaseNotes };
    case 'UP_TO_DATE':
      if (state.phase !== 'checking') return state;
      return { phase: 'up-to-date' };
    case 'DOWNLOAD_PROGRESS':
      if (state.phase !== 'available' && state.phase !== 'downloading') return state;
      return {
        phase: 'downloading',
        percent: action.percent,
        bytesPerSecond: action.bytesPerSecond,
        transferred: action.transferred,
        total: action.total,
      };
    case 'DOWNLOAD_COMPLETE':
      if (state.phase !== 'downloading') return state;
      return { phase: 'ready', version: action.version };
    case 'ERROR':
      return { phase: 'error', message: action.message };
    case 'DISMISS':
      if (state.phase === 'downloading') return state;
      return { phase: 'dismissed' };
    case 'INSTALL_NOW':
      if (state.phase !== 'ready') return state;
      return { phase: 'idle' };
    default:
      return state;
  }
}
