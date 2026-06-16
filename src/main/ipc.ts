import { ipcMain, dialog, type WebContents } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  IPC_CHANNELS,
  type BackupChooseFolderResponse,
  type BackupExportResponse,
  type BackupRestoreResponse,
  type BackupAutoRunResponse,
  type ExportCsvRequest,
  type ExportCsvResponse,
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
  type CardMoveToCollectionRequest,
  type CardMoveToCollectionResponse,
  type CollectionsCreateRequest,
  type CollectionsCreateResponse,
  type CollectionsDeleteRequest,
  type CollectionsDeleteResponse,
  type CollectionsListResponse,
  type CollectionsRenameRequest,
  type CollectionsRenameResponse,
  type GetSettingRequest,
  type GetSettingResponse,
  type ListCardsResponse,
  type ListRecentScansResponse,
  type ReviewBulkConfirmFoilRequest,
  type ReviewBulkConfirmFoilResponse,
  type ReviewBulkConfirmSetRequest,
  type ReviewBulkConfirmSetResponse,
  type ReviewBulkDismissRequest,
  type ReviewBulkDismissResponse,
  type ReviewConfirmFieldCorrectionsRequest,
  type ReviewConfirmFieldCorrectionsResponse,
  type ReviewConfirmRequest,
  type ReviewConfirmResponse,
  type ReviewCountDto,
  type ReviewCountResponse,
  type ReviewDismissRequest,
  type ReviewDismissResponse,
  type ReviewListAllResponse,
  type ReviewListPendingResponse,
  type ReviewSkipRequest,
  type ReviewSkipResponse,
  type ScanQueueDepthDto,
  type ScryfallCheckUpdateResponse,
  type ScryfallRefreshResponse,
  type ScryfallUpdateAvailableDto,
  type SetProgressDto,
  type SetSettingRequest,
  type SetSettingResponse,
  type SetWithStatusDto,
  type SetsListResponse,
  type SetsToggleDownloadRequest,
  type SetsToggleDownloadResponse,
} from '../shared/ipc.js';
import { checkNeedsRefresh } from './scryfall-update-checker.js';
import { fetchBulkDataManifest } from './scryfall-bulk.js';
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
import type { ReviewQueueDb } from './review-queue-db.js';
import { resolveReviewItem } from './review-resolver.js';
import { planBulkReviewAction } from './bulk-review-planner.js';
import { planMoveToCollection } from './move-to-collection-planner.js';
import { toMoxfieldCsv, toDeckboxCsv, toManaBoxCsv, toMimirNativeCsv, type ExportCard } from './csv-export.js';
import { createBackupZip, restoreFromZip, writeAutoBackupFile, validateRestoreZip } from './backup.js';

export interface IpcDeps {
  catalogue: CatalogueDb;
  index: ScryfallIndexDb;
  bootstrap: BootstrapOrchestrator;
  artCrops: ArtCropOrchestrator;
  scanDb: ScanDb;
  settingsDb: SettingsDb;
  thumbnailsDir: string;
  catalogueDbPath: string;
  appVersion: string;
  currentSchemaVersion: number;
  processingQueue: ProcessingQueue;
  reviewQueueDb: ReviewQueueDb;
  broadcastReviewCount: () => void;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { catalogue, index, bootstrap, artCrops, scanDb, settingsDb, thumbnailsDir, catalogueDbPath, appVersion, currentSchemaVersion, processingQueue, reviewQueueDb, broadcastReviewCount } = deps;

  ipcMain.handle(
    IPC_CHANNELS.exportCsv,
    async (_event, req: ExportCsvRequest): Promise<ExportCsvResponse> => {
      try {
        const allCards = catalogue.listCards();
        const allCollections = catalogue.listCollections();
        const colMap = new Map(allCollections.map((c) => [c.id, c.name]));

        const scopedCards = req.scope === 'collection' && req.collectionId != null
          ? allCards.filter((c) => c.collection_id === req.collectionId)
          : allCards;

        const exportCards: ExportCard[] = scopedCards.map((c) => ({
          ...c,
          collection_name: colMap.get(c.collection_id) ?? 'Unknown',
        }));

        let csv: string;
        let defaultName: string;
        const date = new Date().toISOString().slice(0, 10);

        switch (req.format) {
          case 'moxfield':
            csv = toMoxfieldCsv(exportCards);
            defaultName = `mimir-moxfield-${date}.csv`;
            break;
          case 'deckbox':
            csv = toDeckboxCsv(exportCards);
            defaultName = `mimir-deckbox-${date}.csv`;
            break;
          case 'manabox':
            csv = toManaBoxCsv(exportCards);
            defaultName = `mimir-manabox-${date}.csv`;
            break;
          default:
            csv = toMimirNativeCsv(exportCards);
            defaultName = `mimir-native-${date}.csv`;
            break;
        }

        const result = await dialog.showSaveDialog({
          defaultPath: defaultName,
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });

        if (result.canceled || !result.filePath) {
          return { ok: true, savedPath: null };
        }

        await writeFile(result.filePath, csv, 'utf8');
        return { ok: true, savedPath: result.filePath };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

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

  ipcMain.handle(IPC_CHANNELS.collectionsList, async (): Promise<CollectionsListResponse> => {
    try {
      return { ok: true, collections: catalogue.listCollections() };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.collectionsCreate,
    async (_event, req: CollectionsCreateRequest): Promise<CollectionsCreateResponse> => {
      try {
        const name = req.name.trim();
        if (!name) return { ok: false, error: 'Collection name cannot be empty' };
        const id = catalogue.createCollection(name);
        return { ok: true, id };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.collectionsRename,
    async (_event, req: CollectionsRenameRequest): Promise<CollectionsRenameResponse> => {
      try {
        const name = req.name.trim();
        if (!name) return { ok: false, error: 'Collection name cannot be empty' };
        catalogue.renameCollection(req.id, name);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.collectionsDelete,
    async (_event, req: CollectionsDeleteRequest): Promise<CollectionsDeleteResponse> => {
      try {
        catalogue.deleteCollection(req.id, req.mode, req.targetCollectionId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.cardMoveToCollection,
    async (_event, req: CardMoveToCollectionRequest): Promise<CardMoveToCollectionResponse> => {
      try {
        const sourceRow = catalogue.findCardById(req.cardId);
        if (!sourceRow) return { ok: false, error: `Card ${req.cardId} not found` };

        const existingInDest = catalogue.findCardInCollection(
          sourceRow.scryfall_id,
          sourceRow.foil,
          sourceRow.condition,
          sourceRow.language,
          req.targetCollectionId,
        );

        const actions = planMoveToCollection(sourceRow, req.targetCollectionId, existingInDest);
        for (const action of actions) {
          catalogue.executeAction(action);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

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
        processingQueue.enqueue({ scanId: id, thumbnailPath: thumbPath, capturedAt, preset: req.preset });
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

  ipcMain.handle(IPC_CHANNELS.reviewListPending, async (): Promise<ReviewListPendingResponse> => {
    try {
      return { ok: true, items: reviewQueueDb.listPendingItems(1) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.reviewListAll, async (): Promise<ReviewListAllResponse> => {
    try {
      return { ok: true, items: reviewQueueDb.listAllPendingItems() };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.reviewCount, async (): Promise<ReviewCountResponse> => {
    try {
      return { ok: true, count: reviewQueueDb.getPendingCount() };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.reviewConfirm,
    async (_event, req: ReviewConfirmRequest): Promise<ReviewConfirmResponse> => {
      try {
        const item = reviewQueueDb.getItemById(req.reviewId);
        if (!item) return { ok: false, error: `Review item ${req.reviewId} not found` };

        const inboxId = catalogue.inboxCollectionId();
        const existing = catalogue.findCardByScryfallId(req.scryfallId, 'normal', 'NM', 'EN', inboxId);
        const actions = resolveReviewItem(item, { kind: 'confirm', scryfallId: req.scryfallId }, existing, inboxId, Date.now());

        let resolvedCardId: number | null = null;
        for (const action of actions) {
          switch (action.kind) {
            case 'insert':
            case 'bump':
              resolvedCardId = catalogue.executeAction(action);
              break;
            case 'update-scan-card': {
              const cardId = action.cardId ?? resolvedCardId;
              if (cardId != null && action.scanId != null) {
                scanDb.updateScanCard(action.scanId, cardId);
              }
              break;
            }
            case 'resolve-review-queue':
              reviewQueueDb.resolveItem(action.reviewId, action.scryfallId);
              break;
          }
        }
        broadcastReviewCount();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewSkip,
    async (_event, req: ReviewSkipRequest): Promise<ReviewSkipResponse> => {
      try {
        reviewQueueDb.skipItem(req.reviewId);
        broadcastReviewCount();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewDismiss,
    async (_event, req: ReviewDismissRequest): Promise<ReviewDismissResponse> => {
      try {
        const item = reviewQueueDb.getItemById(req.reviewId);
        if (!item) return { ok: false, error: `Review item ${req.reviewId} not found` };

        const actions = resolveReviewItem(item, { kind: 'dismiss' }, null, catalogue.inboxCollectionId(), Date.now());
        for (const action of actions) {
          switch (action.kind) {
            case 'delete-scan':
              scanDb.deleteScan(action.scanId);
              break;
            case 'dismiss-review-queue':
              reviewQueueDb.dismissItem(action.reviewId);
              break;
          }
        }
        broadcastReviewCount();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewBulkDismiss,
    async (_event, req: ReviewBulkDismissRequest): Promise<ReviewBulkDismissResponse> => {
      try {
        const now = Date.now();
        const inboxId = catalogue.inboxCollectionId();
        const inputs = req.reviewIds.flatMap((id) => {
          const item = reviewQueueDb.getItemById(id);
          return item ? [{ item, existingCard: null as null }] : [];
        });
        const actions = planBulkReviewAction(inputs, { kind: 'dismiss-all' }, inboxId, now);
        for (const action of actions) {
          switch (action.kind) {
            case 'delete-scan': scanDb.deleteScan(action.scanId); break;
            case 'dismiss-review-queue': reviewQueueDb.dismissItem(action.reviewId); break;
          }
        }
        broadcastReviewCount();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewBulkConfirmFoil,
    async (_event, req: ReviewBulkConfirmFoilRequest): Promise<ReviewBulkConfirmFoilResponse> => {
      try {
        const now = Date.now();
        const inboxId = catalogue.inboxCollectionId();
        const inputs = req.reviewIds.flatMap((id) => {
          const item = reviewQueueDb.getItemById(id);
          if (!item) return [];
          const topCandidate = item.candidates[0];
          const existingCard = topCandidate
            ? catalogue.findCardByScryfallId(topCandidate.scryfallId, 'foil', 'NM', 'EN', inboxId)
            : null;
          return [{ item, existingCard }];
        });
        const actions = planBulkReviewAction(inputs, { kind: 'confirm-all-foil' }, inboxId, now);
        let resolvedCardId: number | null = null;
        for (const action of actions) {
          switch (action.kind) {
            case 'insert':
            case 'bump':
              resolvedCardId = catalogue.executeAction(action);
              break;
            case 'update-scan-card': {
              const cardId = action.cardId ?? resolvedCardId;
              if (cardId != null && action.scanId != null) scanDb.updateScanCard(action.scanId, cardId);
              break;
            }
            case 'resolve-review-queue':
              reviewQueueDb.resolveItem(action.reviewId, action.scryfallId);
              resolvedCardId = null;
              break;
          }
        }
        broadcastReviewCount();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewConfirmFieldCorrections,
    async (_event, req: ReviewConfirmFieldCorrectionsRequest): Promise<ReviewConfirmFieldCorrectionsResponse> => {
      try {
        catalogue.updateCardFields(req.cardId, { foil: req.foil, language: req.language });
        catalogue.clearCardReviewState(req.cardId);
        reviewQueueDb.resolveItem(req.reviewId, '');
        broadcastReviewCount();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.scryfallCheckUpdate,
    async (): Promise<ScryfallCheckUpdateResponse> => {
      try {
        const manifest = await fetchBulkDataManifest('default_cards');
        const localState = index.getIndexState();
        const result = checkNeedsRefresh(localState.bulkDataLastFetchedAt, manifest.updated_at);
        return { ok: true, result, remoteUpdatedAt: manifest.updated_at };
      } catch {
        return { ok: false, error: 'Could not reach Scryfall' };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.scryfallRefresh,
    async (): Promise<ScryfallRefreshResponse> => {
      try {
        bootstrap.forceStart().catch(() => {/* surfaced via progress events */});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewBulkConfirmSet,
    async (_event, req: ReviewBulkConfirmSetRequest): Promise<ReviewBulkConfirmSetResponse> => {
      try {
        const now = Date.now();
        const inboxId = catalogue.inboxCollectionId();
        const inputs = req.reviewIds.flatMap((id) => {
          const item = reviewQueueDb.getItemById(id);
          if (!item) return [];
          const candidate = item.candidates.find((c) => c.setCode === req.setCode);
          const existingCard = candidate
            ? catalogue.findCardByScryfallId(candidate.scryfallId, 'normal', 'NM', 'EN', inboxId)
            : null;
          return [{ item, existingCard }];
        });
        const actions = planBulkReviewAction(inputs, { kind: 'mark-all-as-set', setCode: req.setCode }, inboxId, now);
        let resolvedCardId: number | null = null;
        for (const action of actions) {
          switch (action.kind) {
            case 'insert':
            case 'bump':
              resolvedCardId = catalogue.executeAction(action);
              break;
            case 'update-scan-card': {
              const cardId = action.cardId ?? resolvedCardId;
              if (cardId != null && action.scanId != null) scanDb.updateScanCard(action.scanId, cardId);
              break;
            }
            case 'resolve-review-queue':
              reviewQueueDb.resolveItem(action.reviewId, action.scryfallId);
              resolvedCardId = null;
              break;
          }
        }
        broadcastReviewCount();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.backupChooseFolder,
    async (): Promise<BackupChooseFolderResponse> => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: true, cancelled: true };
        }
        return { ok: true, folder: result.filePaths[0]! };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.backupExport,
    async (): Promise<BackupExportResponse> => {
      try {
        const zipBuffer = await createBackupZip(catalogue.raw, catalogueDbPath, thumbnailsDir, currentSchemaVersion, appVersion);

        const date = new Date().toISOString().slice(0, 10);
        const result = await dialog.showSaveDialog({
          defaultPath: `mimir-backup-${date}.zip`,
          filters: [{ name: 'Mimir Backup', extensions: ['zip'] }],
        });

        if (result.canceled || !result.filePath) {
          return { ok: true, savedPath: null };
        }

        await writeFile(result.filePath, zipBuffer);
        return { ok: true, savedPath: result.filePath };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.backupRestore,
    async (): Promise<BackupRestoreResponse> => {
      try {
        const result = await dialog.showOpenDialog({
          filters: [{ name: 'Mimir Backup', extensions: ['zip'] }],
          properties: ['openFile'],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, error: 'Cancelled' };
        }

        const zipBuffer = await readFile(result.filePaths[0]!);
        const restoreResult = await restoreFromZip(
          new Uint8Array(zipBuffer),
          catalogueDbPath,
          thumbnailsDir,
          currentSchemaVersion,
          async (_path) => { /* migrations run by DB open on next launch */ },
        );

        if (!restoreResult.ok) {
          return { ok: false, error: restoreResult.error };
        }

        const msg = restoreResult.compatibility === 'needs-migration'
          ? 'Backup restored and migrated. Please restart Mimir to reload the catalogue.'
          : 'Backup restored successfully. Please restart Mimir to reload the catalogue.';
        return { ok: true, message: msg };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.backupAutoRun,
    async (): Promise<BackupAutoRunResponse> => {
      try {
        const folder = settingsDb.get('backup.folder');
        if (!folder) {
          return { ok: false, error: 'No backup folder configured' };
        }
        const retain = parseInt(settingsDb.get('backup.retainCount') ?? '4', 10);
        const zipBuffer = await createBackupZip(catalogue.raw, catalogueDbPath, thumbnailsDir, currentSchemaVersion, appVersion);
        const savedPath = await writeAutoBackupFile(zipBuffer, folder, retain);
        settingsDb.set('backup.lastBackupAt', String(Date.now()));
        settingsDb.set('backup.consecutiveFailures', '0');
        return { ok: true, savedPath };
      } catch (err) {
        const current = parseInt(settingsDb.get('backup.consecutiveFailures') ?? '0', 10);
        settingsDb.set('backup.consecutiveFailures', String(current + 1));
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

export function makeBroadcastReviewCount(
  webContentsList: () => WebContents[],
  reviewQueueDb: ReviewQueueDb,
): () => void {
  return function broadcastReviewCount(): void {
    const count = reviewQueueDb.getPendingCount();
    const dto: ReviewCountDto = { count };
    for (const wc of webContentsList()) {
      if (!wc.isDestroyed()) {
        wc.send(IPC_CHANNELS.reviewPendingUpdate, dto);
      }
    }
  };
}

export function broadcastScryfallUpdateAvailable(
  webContentsList: () => WebContents[],
  dto: ScryfallUpdateAvailableDto,
): void {
  for (const wc of webContentsList()) {
    if (!wc.isDestroyed()) {
      wc.send(IPC_CHANNELS.scryfallUpdateAvailable, dto);
    }
  }
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
