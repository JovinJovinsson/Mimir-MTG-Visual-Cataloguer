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
  type SetProgressDto,
  type SetWithStatusDto,
  type SetsListResponse,
  type SetsToggleDownloadRequest,
  type SetsToggleDownloadResponse,
} from '../shared/ipc.js';
import type { CatalogueDb } from './database.js';
import type { ScryfallIndexDb } from './scryfall-index.js';
import type { BootstrapOrchestrator } from './bootstrap.js';
import type {
  ArtCropOrchestrator,
  SetCropProgressEvent,
} from './art-crop-orchestrator.js';
import { estimateDiskUsageBytes } from './art-crop-planner.js';
import { fetchScryfallCardById } from './scryfall.js';
import type { CardForRenderer, Foil } from '../shared/types.js';

export interface IpcDeps {
  catalogue: CatalogueDb;
  index: ScryfallIndexDb;
  bootstrap: BootstrapOrchestrator;
  artCrops: ArtCropOrchestrator;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { catalogue, index, bootstrap, artCrops } = deps;

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

  ipcMain.handle(IPC_CHANNELS.setsList, async (): Promise<SetsListResponse> => {
    try {
      const sets: SetWithStatusDto[] = index.listSetsWithStatus().map((s) => ({
        code: s.code,
        name: s.name,
        card_count: s.card_count,
        hashed_count: s.hashed_count,
        download_status: s.download_status,
        is_downloaded: s.is_downloaded,
        estimated_disk_bytes: estimateDiskUsageBytes(s.card_count),
      }));
      return { ok: true, sets };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.setsToggleDownload,
    async (
      _event,
      req: SetsToggleDownloadRequest,
    ): Promise<SetsToggleDownloadResponse> => {
      try {
        if (req.enabled) {
          void artCrops.startSetDownload(req.setCode);
        } else {
          void artCrops.removeSetCrops(req.setCode);
        }
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

export function broadcastArtCropProgress(
  webContentsList: () => WebContents[],
  artCrops: ArtCropOrchestrator,
): void {
  artCrops.on('progress', (event: SetCropProgressEvent) => {
    const dto: SetProgressDto = { ...event };
    for (const wc of webContentsList()) {
      if (!wc.isDestroyed()) {
        wc.send(IPC_CHANNELS.setsProgress, dto);
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
