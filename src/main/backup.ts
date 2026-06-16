import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readdir, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { Database } from 'better-sqlite3';

export interface VersionMeta {
  schema_version: number;
  app_version: string;
  exported_at: string;
}

export type RestoreCompatibility = 'compatible' | 'needs-migration' | 'incompatible-newer';

export type BackupCadence = 'on-quit' | 'daily' | 'weekly' | 'monthly';

export interface ThumbnailFile {
  relativePath: string;
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Pure functions (testable without I/O)
// ---------------------------------------------------------------------------

export function buildBackupZip(
  catalogueDbBuffer: Uint8Array,
  thumbnailFiles: ThumbnailFile[],
  versionMeta: VersionMeta,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'catalogue.db': catalogueDbBuffer,
    'version.json': strToU8(JSON.stringify(versionMeta, null, 2)),
  };
  for (const tf of thumbnailFiles) {
    files[`scans/thumbnails/${tf.relativePath}`] = tf.data;
  }
  return zipSync(files, { level: 1 });
}

export function validateRestoreZip(
  zipVersionJson: string,
  currentAppSchemaVersion: number,
): RestoreCompatibility {
  const meta = JSON.parse(zipVersionJson) as VersionMeta;
  if (meta.schema_version === currentAppSchemaVersion) return 'compatible';
  if (meta.schema_version < currentAppSchemaVersion) return 'needs-migration';
  return 'incompatible-newer';
}

const CADENCE_MS: Record<Exclude<BackupCadence, 'on-quit'>, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function computeNextAutoBackupAt(
  cadence: BackupCadence,
  lastBackupAt: number | null,
  now: number,
): number | null {
  if (cadence === 'on-quit') return null;
  if (lastBackupAt === null) return now;
  const intervalMs = CADENCE_MS[cadence];
  if (now - lastBackupAt >= intervalMs) return now;
  return null;
}

export function selectBackupsToDelete(files: string[], retainCount: number): string[] {
  if (files.length <= retainCount) return [];
  const sorted = [...files].sort();
  return sorted.slice(0, files.length - retainCount);
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

export async function createBackupZip(
  db: Database,
  catalogueDbPath: string,
  thumbnailsDir: string,
  schemaVersion: number,
  appVersion: string,
): Promise<Uint8Array> {
  // Snapshot DB via SQLite backup API to avoid torn writes
  const tmpPath = join(tmpdir(), `mimir-backup-${Date.now()}.db`);
  await db.backup(tmpPath);
  const dbBuffer = await readFile(tmpPath);
  await rm(tmpPath, { force: true });

  const thumbnailFiles: ThumbnailFile[] = [];
  if (existsSync(thumbnailsDir)) {
    const filenames = await readdir(thumbnailsDir);
    for (const filename of filenames) {
      const data = await readFile(join(thumbnailsDir, filename));
      thumbnailFiles.push({ relativePath: filename, data });
    }
  }

  const versionMeta: VersionMeta = {
    schema_version: schemaVersion,
    app_version: appVersion,
    exported_at: new Date().toISOString(),
  };

  return buildBackupZip(new Uint8Array(dbBuffer), thumbnailFiles, versionMeta);
}

export type RestoreResult =
  | { ok: true; compatibility: RestoreCompatibility }
  | { ok: false; error: string };

export async function restoreFromZip(
  zipBuffer: Uint8Array,
  catalogueDbPath: string,
  thumbnailsDir: string,
  currentSchemaVersion: number,
  runMigrations: (dbPath: string) => Promise<void>,
): Promise<RestoreResult> {
  try {
    const entries = unzipSync(zipBuffer);

    const versionEntry = entries['version.json'];
    if (!versionEntry) {
      return { ok: false, error: 'Archive is missing version.json — not a valid Mimir backup.' };
    }
    const versionJson = strFromU8(versionEntry);
    const compatibility = validateRestoreZip(versionJson, currentSchemaVersion);

    if (compatibility === 'incompatible-newer') {
      const meta = JSON.parse(versionJson) as VersionMeta;
      return {
        ok: false,
        error: `This backup requires schema version ${meta.schema_version}, but this app only supports up to version ${currentSchemaVersion}. Please update Mimir to restore this backup.`,
      };
    }

    const dbEntry = entries['catalogue.db'];
    if (!dbEntry) {
      return { ok: false, error: 'Archive is missing catalogue.db — not a valid Mimir backup.' };
    }

    // Write new DB to a temp path, then atomically swap
    const dbDir = dirname(catalogueDbPath);
    const tmpDbPath = join(dbDir, `catalogue.db.restore-${Date.now()}`);
    await mkdir(dbDir, { recursive: true });
    await writeFile(tmpDbPath, dbEntry);

    if (compatibility === 'needs-migration') {
      await runMigrations(tmpDbPath);
    }

    // Restore thumbnails
    const thumbPrefix = 'scans/thumbnails/';
    const thumbEntries = Object.entries(entries).filter(([k]) => k.startsWith(thumbPrefix));
    await mkdir(thumbnailsDir, { recursive: true });
    for (const [entryPath, data] of thumbEntries) {
      const filename = basename(entryPath);
      await writeFile(join(thumbnailsDir, filename), data);
    }

    // Atomic swap: rename new DB over old
    await rename(tmpDbPath, catalogueDbPath);

    return { ok: true, compatibility };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}


export async function writeAutoBackupFile(
  zipBuffer: Uint8Array,
  backupFolder: string,
  retainCount: number,
): Promise<string> {
  await mkdir(backupFolder, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `mimir-backup-${timestamp}.zip`;
  const destPath = join(backupFolder, filename);
  await writeFile(destPath, zipBuffer);

  // Prune old backups
  const allFiles = await readdir(backupFolder);
  const backupFiles = allFiles
    .filter((f) => f.startsWith('mimir-backup-') && f.endsWith('.zip'));
  const toDelete = selectBackupsToDelete(backupFiles, retainCount);
  for (const f of toDelete) {
    await rm(join(backupFolder, f), { force: true });
  }

  return destPath;
}
