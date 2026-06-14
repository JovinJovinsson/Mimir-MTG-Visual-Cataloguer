import { app, BrowserWindow, webContents as electronWebContents } from 'electron';
import { join } from 'node:path';
import { openCatalogueDb, defaultCataloguePath, type CatalogueDb } from './database.js';
import {
  openScryfallIndexDb,
  defaultScryfallIndexPath,
  type ScryfallIndexDb,
} from './scryfall-index.js';
import { BootstrapOrchestrator } from './bootstrap.js';
import { fetchBulkDataManifest, fetchBulkData, RateLimiter, retryOn429 } from './scryfall-bulk.js';
import { broadcastBootstrapProgress, registerIpcHandlers } from './ipc.js';

let catalogue: CatalogueDb | null = null;
let index: ScryfallIndexDb | null = null;

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

  const limiter = new RateLimiter(150);

  const bootstrap = new BootstrapOrchestrator({
    index,
    fetchManifest: async (bulkType) => {
      await limiter.acquire();
      return retryOn429(() => fetchBulkDataManifest(bulkType), { maxRetries: 3 });
    },
    fetchBulk: async (uri) => {
      await limiter.acquire();
      return retryOn429(() => fetchBulkData(uri), { maxRetries: 3 });
    },
  });

  registerIpcHandlers({ catalogue, index, bootstrap });
  broadcastBootstrapProgress(() => electronWebContents.getAllWebContents(), bootstrap);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    catalogue?.close();
    index?.close();
    catalogue = null;
    index = null;
    app.quit();
  }
});

app.on('will-quit', () => {
  catalogue?.close();
  index?.close();
  catalogue = null;
  index = null;
});
