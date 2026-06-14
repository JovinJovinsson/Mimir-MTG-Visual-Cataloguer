import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { openCatalogueDb, defaultCataloguePath, type CatalogueDb } from './database.js';
import { registerIpcHandlers } from './ipc.js';

let db: CatalogueDb | null = null;

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
  const dbPath = defaultCataloguePath(app.getPath('userData'));
  db = openCatalogueDb(dbPath);
  registerIpcHandlers(db);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close();
    db = null;
    app.quit();
  }
});

app.on('will-quit', () => {
  db?.close();
  db = null;
});
