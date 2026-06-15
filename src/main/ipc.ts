import { ipcMain, type WebContents } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  type CaptureRequest,
  type CaptureResponse,
  type GetSettingRequest,
  type GetSettingResponse,
  type ListCardsResponse,
  type ListRecentScansResponse,
  type ScanQueueDepthDto,
  type SetProgressDto,
  type SetSettingRequest,
  type SetSettingResponse,
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
import type { ScanDb } from './scan-db.js';
import type { SettingsDb } from './settings-db.js';
import { buildScanRow } from './scan-row-builder.js';
import type { ProcessingQueue, ScanQueueDepthEvent } from './processing-queue.js';

export interface IpcDeps {
  catalogue: CatalogueDb;
  index: ScryfallIndexDb;
  bootstrap: BootstrapOrchestrator;
  artCrops: ArtCropOrchestrator;
  scanDb: ScanDb;
  settingsDb: SettingsDb;
  thumbnailsDir: string;
  processingQueue: ProcessingQueue;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { catalogue, index, bootstrap, artCrops, scanDb, settingsDb, thumbnailsDir, processingQueue } = deps;

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
      // Fire-and-forget but attach a catch so rejections don't become unhandled.
      // Errors during the run are surfaced via progress events (phase === 'error').
      bootstrap.start(req.selection).catch(() => {/* handled via progress events */});
      return { ok: true };
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

  ipcMain.handle(
    IPC_CHANNELS.scansCapture,
    async (_event, req: CaptureRequest): Promise<CaptureResponse> => {
      try {
        const base64 = req.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        await mkdir(thumbnailsDir, { recursive: true });
        const capturedAt = Date.now();
        const filename = `${capturedAt}.jpg`;
        const thumbPath = join(thumbnailsDir, filename);
        await writeFile(thumbPath, buffer);
        const row = buildScanRow({ thumbnailPath: thumbPath, capturedAt });
        const id = scanDb.insertScan(row);
        processingQueue.enqueue({ scanId: id, thumbnailPath: thumbPath, capturedAt });
        return { ok: true, scan: { id, captured_at: capturedAt, thumbnail_path: thumbPath } };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.scansListRecent,
    async (_event, req: { limit?: number }): Promise<ListRecentScansResponse> => {
      try {
        const limit = Math.max(1, Math.min(50, req?.limit ?? 8));
        return { ok: true, scans: scanDb.listRecentScans(limit) };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsGet,
    async (_event, req: GetSettingRequest): Promise<GetSettingResponse> => {
      try {
        return { ok: true, value: settingsDb.get(req.key) };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsSet,
    async (_event, req: SetSettingRequest): Promise<SetSettingResponse> => {
      try {
        settingsDb.set(req.key, req.value);
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

export function broadcastScanQueueDepth(
  webContentsList: () => WebContents[],
  processingQueue: ProcessingQueue,
): void {
  processingQueue.on('depth', (event: ScanQueueDepthEvent) => {
    const dto: ScanQueueDepthDto = { depth: event.depth, etaMs: event.etaMs };
    for (const wc of webContentsList()) {
      if (!wc.isDestroyed()) {
        wc.send(IPC_CHANNELS.scanQueueDepth, dto);
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
