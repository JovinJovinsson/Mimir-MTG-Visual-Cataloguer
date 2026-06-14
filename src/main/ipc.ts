import { ipcMain, type WebContents } from 'electron';
import {
  IPC_CHANNELS,
  type AddCardByIdRequest,
  type AddCardByIdResponse,
  type AddCardByNameRequest,
  type AddCardByNameResponse,
  type AutocompleteResponse,
  type BootstrapStartRequest,
  type BootstrapStartResponse,
  type BootstrapStatusDto,
  type ListCardsResponse,
} from '../shared/ipc.js';
import type { CatalogueDb } from './database.js';
import type { ScryfallIndexDb } from './scryfall-index.js';
import type { BootstrapOrchestrator } from './bootstrap.js';
import { fetchScryfallCardById } from './scryfall.js';
import type { CardForRenderer, Foil } from '../shared/types.js';

export interface IpcDeps {
  catalogue: CatalogueDb;
  index: ScryfallIndexDb;
  bootstrap: BootstrapOrchestrator;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { catalogue, index, bootstrap } = deps;

  ipcMain.handle(
    IPC_CHANNELS.addCardById,
    async (_event, req: AddCardByIdRequest): Promise<AddCardByIdResponse> => {
      try {
        const card = await fetchScryfallCardById(req.scryfall_id);
        const foil = pickFoil(card.available_finishes, req.foil);
        const result = catalogue.addCard({
          scryfall_id: card.scryfall_id,
          name: card.name,
          set_code: card.set_code,
          set_name: card.set_name,
          collector_number: card.collector_number,
          foil,
          condition: req.condition ?? 'NM',
          language: req.language ?? 'EN',
          price_usd: card.price_usd,
        });
        return { ok: true, id: result.id, created: result.created, card: findCard(catalogue, result.id) };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.addCardByName,
    async (_event, req: AddCardByNameRequest): Promise<AddCardByNameResponse> => {
      try {
        const indexCard = index.getCardByScryfallId(req.scryfall_id);
        if (!indexCard) {
          return { ok: false, error: `Card ${req.scryfall_id} not found in local index` };
        }
        const result = catalogue.addCard({
          scryfall_id: indexCard.scryfall_id,
          name: indexCard.name,
          set_code: indexCard.set_code,
          set_name: indexCard.set_name,
          collector_number: indexCard.collector_number,
          foil: req.foil ?? 'normal',
          condition: req.condition ?? 'NM',
          language: req.language ?? 'EN',
          price_usd: indexCard.price_usd,
        });
        return { ok: true, id: result.id, created: result.created, card: findCard(catalogue, result.id) };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.listCards, async (): Promise<ListCardsResponse> => {
    try {
      return { ok: true, cards: catalogue.listCards() };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.autocompleteByName,
    async (_event, req: { query: string; limit?: number }): Promise<AutocompleteResponse> => {
      try {
        const limit = Math.max(1, Math.min(50, req.limit ?? 12));
        const hits = index.autocompleteByName(req.query, limit);
        return { ok: true, hits };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.bootstrapStatus, async (): Promise<BootstrapStatusDto> => {
    return bootstrap.status();
  });

  ipcMain.handle(
    IPC_CHANNELS.bootstrapStart,
    async (_event, req: BootstrapStartRequest): Promise<BootstrapStartResponse> => {
      try {
        void bootstrap.start(req.selection);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );
}

export function broadcastBootstrapProgress(
  webContentsList: () => WebContents[],
  bootstrap: BootstrapOrchestrator,
): void {
  bootstrap.on('progress', (status: BootstrapStatusDto) => {
    for (const wc of webContentsList()) {
      if (!wc.isDestroyed()) {
        wc.send(IPC_CHANNELS.bootstrapProgress, status);
      }
    }
  });
}

function pickFoil(available: Foil[], requested?: Foil): Foil {
  if (requested && available.includes(requested)) return requested;
  if (available.includes('normal')) return 'normal';
  return available[0] ?? 'normal';
}

function findCard(db: CatalogueDb, id: number): CardForRenderer {
  const all = db.listCards();
  const card = all.find((c) => c.id === id);
  if (!card) throw new Error(`Card ${id} not found after insert/bump`);
  return card;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
