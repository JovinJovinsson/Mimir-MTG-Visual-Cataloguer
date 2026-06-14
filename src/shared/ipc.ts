import type { CardForRenderer, Condition, Foil } from './types.js';

export const IPC_CHANNELS = {
  addCardById: 'catalogue:addCardById',
  addCardByName: 'catalogue:addCardByName',
  listCards: 'catalogue:listCards',
  autocompleteByName: 'catalogue:autocompleteByName',
  bootstrapStatus: 'bootstrap:status',
  bootstrapStart: 'bootstrap:start',
  bootstrapProgress: 'bootstrap:progress',
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

export interface MimirApi {
  addCardById(req: AddCardByIdRequest): Promise<AddCardByIdResponse>;
  addCardByName(req: AddCardByNameRequest): Promise<AddCardByNameResponse>;
  listCards(): Promise<ListCardsResponse>;
  autocompleteByName(query: string, limit?: number): Promise<AutocompleteResponse>;
  bootstrapStatus(): Promise<BootstrapStatusDto>;
  bootstrapStart(req: BootstrapStartRequest): Promise<BootstrapStartResponse>;
  onBootstrapProgress(cb: (status: BootstrapStatusDto) => void): () => void;
}

declare global {
  interface Window {
    mimir: MimirApi;
  }
}
