import type { CardForRenderer, Condition, Foil, ScanForRenderer } from './types.js';

export const IPC_CHANNELS = {
  addCardById: 'catalogue:addCardById',
  addCardByName: 'catalogue:addCardByName',
  listCards: 'catalogue:listCards',
  autocompleteByName: 'catalogue:autocompleteByName',
  bootstrapStatus: 'bootstrap:status',
  bootstrapStart: 'bootstrap:start',
  bootstrapProgress: 'bootstrap:progress',
  setsList: 'sets:list',
  setsToggleDownload: 'sets:toggleDownload',
  setsProgress: 'sets:progress',
  scansCapture: 'scans:capture',
  scansListRecent: 'scans:listRecent',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const;

export interface AddCardByIdRequest {
  scryfall_id: string;
  foil?: Foil;
  condition?: Condition;
  language?: string;
}

export type AddCardByIdResponse =
  | { ok: true; id: number; created: boolean; card: CardForRenderer }
  | { ok: false; error: string };

export interface AddCardByNameRequest {
  scryfall_id: string;
  foil?: Foil;
  condition?: Condition;
  language?: string;
}

export type AddCardByNameResponse = AddCardByIdResponse;

export type ListCardsResponse =
  | { ok: true; cards: CardForRenderer[] }
  | { ok: false; error: string };

export interface AutocompleteHitDto {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
}

export type AutocompleteResponse =
  | { ok: true; hits: AutocompleteHitDto[] }
  | { ok: false; error: string };

export type BootstrapPhase =
  | 'idle'
  | 'fetching-manifest'
  | 'downloading'
  | 'ingesting'
  | 'done'
  | 'error';

export interface BootstrapStatusDto {
  phase: BootstrapPhase;
  cardCount: number;
  setCount: number;
  scannerGateOpen: boolean;
  totalBytes: number | null;
  ingestedCards: number;
  totalCards: number | null;
  error: string | null;
  updatedAt: number;
}

export type BootstrapStartRequest = { selection: 'full' };
export type BootstrapStartResponse = { ok: true } | { ok: false; error: string };

export type SetDownloadStatus = 'none' | 'downloading' | 'complete' | 'error';

export interface SetWithStatusDto {
  code: string;
  name: string;
  card_count: number;
  hashed_count: number;
  download_status: SetDownloadStatus;
  is_downloaded: number;
  estimated_disk_bytes: number;
}

export type SetsListResponse =
  | { ok: true; sets: SetWithStatusDto[] }
  | { ok: false; error: string };

export interface SetsToggleDownloadRequest {
  setCode: string;
  enabled: boolean;
}

export type SetsToggleDownloadResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface SetProgressDto {
  setCode: string;
  downloaded: number;
  failed: number;
  total: number;
  status: SetDownloadStatus;
}

export interface CaptureRequest {
  dataUrl: string;
}

export type CaptureResponse =
  | { ok: true; scan: ScanForRenderer }
  | { ok: false; error: string };

export type ListRecentScansResponse =
  | { ok: true; scans: ScanForRenderer[] }
  | { ok: false; error: string };

export interface GetSettingRequest {
  key: string;
}

export type GetSettingResponse =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export interface SetSettingRequest {
  key: string;
  value: string;
}

export type SetSettingResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface MimirApi {
  addCardById(req: AddCardByIdRequest): Promise<AddCardByIdResponse>;
  addCardByName(req: AddCardByNameRequest): Promise<AddCardByNameResponse>;
  listCards(): Promise<ListCardsResponse>;
  autocompleteByName(query: string, limit?: number): Promise<AutocompleteResponse>;
  bootstrapStatus(): Promise<BootstrapStatusDto>;
  bootstrapStart(req: BootstrapStartRequest): Promise<BootstrapStartResponse>;
  onBootstrapProgress(cb: (status: BootstrapStatusDto) => void): () => void;
  setsList(): Promise<SetsListResponse>;
  setsToggleDownload(req: SetsToggleDownloadRequest): Promise<SetsToggleDownloadResponse>;
  onSetsProgress(cb: (event: SetProgressDto) => void): () => void;
  scansCapture(req: CaptureRequest): Promise<CaptureResponse>;
  scansListRecent(limit?: number): Promise<ListRecentScansResponse>;
  settingsGet(req: GetSettingRequest): Promise<GetSettingResponse>;
  settingsSet(req: SetSettingRequest): Promise<SetSettingResponse>;
}

declare global {
  interface Window {
    mimir: MimirApi;
  }
}
