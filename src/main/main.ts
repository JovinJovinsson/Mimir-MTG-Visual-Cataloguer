import { app, BrowserWindow, nativeImage, session, webContents as electronWebContents } from 'electron';
import { join } from 'node:path';
import { openCatalogueDb, defaultCataloguePath, type CatalogueDb } from './database.js';
import {
  openScryfallIndexDb,
  defaultScryfallIndexPath,
  SCRYFALL_INDEX_SUBDIR,
  type ScryfallIndexDb,
} from './scryfall-index.js';
import { BootstrapOrchestrator } from './bootstrap.js';
import {
  fetchBulkDataManifest,
  downloadBulkJson,
  RateLimiter,
  SCRYFALL_USER_AGENT,
  retryOn429,
  type HttpError,
} from './scryfall-bulk.js';
import { ArtCropOrchestrator } from './art-crop-orchestrator.js';
import {
  broadcastArtCropProgress,
  broadcastBootstrapProgress,
  broadcastScanQueueDepth,
  broadcastScryfallUpdateAvailable,
  makeBroadcastReviewCount,
  registerIpcHandlers,
} from './ipc.js';
import { checkNeedsRefresh } from './scryfall-update-checker.js';
import { openScanDb } from './scan-db.js';
import { openSettingsDb } from './settings-db.js';
import { ProcessingQueue } from './processing-queue.js';
import { openReviewQueueDb } from './review-queue-db.js';
import { computeNextAutoBackupAt } from './backup.js';
import { catalogueMigrations } from './schema.js';

let catalogue: CatalogueDb | null = null;
let index: ScryfallIndexDb | null = null;

// Populated in app.whenReady so on-quit handler can run auto-backup
let onQuitBackup: (() => Promise<void>) | null = null;
let quitInProgress = false;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Mimir',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  catalogue = openCatalogueDb(defaultCataloguePath(userData));
  index = openScryfallIndexDb(defaultScryfallIndexPath(userData));

  const scanDb = openScanDb(catalogue.raw);
  const settingsDb = openSettingsDb(catalogue.raw);
  const reviewQueueDb = openReviewQueueDb(catalogue.raw);
  const thumbnailsDir = join(userData, 'scans', 'thumbnails');

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  const limiter = new RateLimiter(150);

  const bootstrap = new BootstrapOrchestrator({
    index,
    fetchManifest: async (bulkType) => {
      await limiter.acquire();
      return retryOn429(() => fetchBulkDataManifest(bulkType), { maxRetries: 3 });
    },
    fetchBulk: async (uri, onProgress) => {
      await limiter.acquire();
      return retryOn429(() => downloadBulkJson(uri, onProgress), { maxRetries: 3 });
    },
  });

  const cropsDir = join(userData, SCRYFALL_INDEX_SUBDIR, 'art_crops');
  const artCrops = new ArtCropOrchestrator({
    index,
    cropsDir,
    fetchImage: fetchScryfallImage,
    decodeImage: decodeJpegWithNativeImage,
    rateLimit: () => limiter.acquire(),
  });

  const broadcastReviewCount = makeBroadcastReviewCount(
    () => electronWebContents.getAllWebContents(),
    reviewQueueDb,
  );

  const processingQueue = new ProcessingQueue({
    decodeImage: decodeJpegWithNativeImage,
    index,
    scanDb,
    catalogueDb: catalogue,
    reviewQueueDb,
    onReviewCountChanged: broadcastReviewCount,
  });

  const catalogueDbPath = defaultCataloguePath(userData);
  const currentSchemaVersion = Math.max(...catalogueMigrations.map((m) => m.version));

  registerIpcHandlers({
    catalogue,
    index,
    bootstrap,
    artCrops,
    artCropsDir: cropsDir,
    scanDb,
    settingsDb,
    thumbnailsDir,
    catalogueDbPath,
    appVersion: app.getVersion(),
    currentSchemaVersion,
    processingQueue,
    reviewQueueDb,
    broadcastReviewCount,
  });
  broadcastBootstrapProgress(() => electronWebContents.getAllWebContents(), bootstrap);
  broadcastArtCropProgress(() => electronWebContents.getAllWebContents(), artCrops);
  broadcastScanQueueDepth(() => electronWebContents.getAllWebContents(), processingQueue);

  createWindow();

  // After window is ready, check for Scryfall updates silently.
  // Failure is intentionally swallowed — the app must still work offline.
  void checkScryfallUpdate();

  // Build the auto-backup runner — shared by on-launch and on-quit.
  async function runAutoBackup(): Promise<void> {
    const folder = settingsDb.get('backup.folder');
    if (!folder) return;
    const { createBackupZip: mkZip, writeAutoBackupFile: writeZip } = await import('./backup.js');
    try {
      const retain = parseInt(settingsDb.get('backup.retainCount') ?? '4', 10);
      const zipBuffer = await mkZip(catalogue!.raw, catalogueDbPath, thumbnailsDir, currentSchemaVersion, app.getVersion());
      await writeZip(zipBuffer, folder, retain);
      settingsDb.set('backup.lastBackupAt', String(Date.now()));
      settingsDb.set('backup.consecutiveFailures', '0');
    } catch {
      const current = parseInt(settingsDb.get('backup.consecutiveFailures') ?? '0', 10);
      settingsDb.set('backup.consecutiveFailures', String(current + 1));
    }
  }

  // Register on-quit backup so the module-level before-quit handler can use it.
  onQuitBackup = async () => {
    const cadence = (settingsDb.get('backup.cadence') ?? 'weekly') as string;
    if (cadence !== 'on-quit') return;
    await runAutoBackup();
  };

  // Check if a time-based backup is due on launch.
  void (async () => {
    const cadence = (settingsDb.get('backup.cadence') ?? 'weekly') as 'on-quit' | 'daily' | 'weekly' | 'monthly';
    if (cadence === 'on-quit') return;
    const lastStr = settingsDb.get('backup.lastBackupAt');
    const lastAt = lastStr ? parseInt(lastStr, 10) : null;
    if (computeNextAutoBackupAt(cadence, lastAt, Date.now()) !== null) {
      await runAutoBackup();
    }
  })();

  async function checkScryfallUpdate(): Promise<void> {
    try {
      const manifest = await fetchBulkDataManifest('default_cards');
      const localState = index!.getIndexState();
      if (checkNeedsRefresh(localState.bulkDataLastFetchedAt, manifest.updated_at) === 'needs-refresh') {
        broadcastScryfallUpdateAvailable(
          () => electronWebContents.getAllWebContents(),
          { remoteUpdatedAt: manifest.updated_at },
        );
      }
    } catch {
      // Network unavailable or Scryfall down — fail silently
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

async function fetchScryfallImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': SCRYFALL_USER_AGENT, Accept: 'image/jpeg' },
  });
  if (!res.ok) {
    const err: Error & Partial<HttpError> = new Error(
      `Art crop fetch ${url} returned ${res.status}`,
    );
    err.status = res.status;
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) err.retryAfterMs = seconds * 1000;
    }
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function decodeJpegWithNativeImage(buffer: Buffer): {
  rgba: Uint8Array;
  width: number;
  height: number;
} {
  const img = nativeImage.createFromBuffer(buffer);
  const size = img.getSize();
  const bitmap = img.toBitmap();
  // Electron returns BGRA; convert to RGBA in-place.
  const rgba = new Uint8Array(bitmap.length);
  for (let i = 0; i < bitmap.length; i += 4) {
    rgba[i] = bitmap[i + 2] ?? 0;
    rgba[i + 1] = bitmap[i + 1] ?? 0;
    rgba[i + 2] = bitmap[i] ?? 0;
    rgba[i + 3] = bitmap[i + 3] ?? 255;
  }
  return { rgba, width: size.width, height: size.height };
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    catalogue?.close();
    index?.close();
    catalogue = null;
    index = null;
    app.quit();
  }
});

// Run on-quit backup before closing, then let quit proceed.
app.on('before-quit', (event) => {
  if (quitInProgress || !onQuitBackup) return;
  event.preventDefault();
  quitInProgress = true;
  void onQuitBackup().finally(() => {
    catalogue?.close();
    index?.close();
    catalogue = null;
    index = null;
    app.quit();
  });
});

app.on('will-quit', () => {
  catalogue?.close();
  index?.close();
  catalogue = null;
  index = null;
});
