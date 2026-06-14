import type { CardForRenderer, Condition, Foil } from './types.js';

export const IPC_CHANNELS = {
  addCardById: 'catalogue:addCardById',
  listCards: 'catalogue:listCards',
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

export type ListCardsResponse =
  | { ok: true; cards: CardForRenderer[] }
  | { ok: false; error: string };

export interface MimirApi {
  addCardById(req: AddCardByIdRequest): Promise<AddCardByIdResponse>;
  listCards(): Promise<ListCardsResponse>;
}

declare global {
  interface Window {
    mimir: MimirApi;
  }
}
