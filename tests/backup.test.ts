import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildBackupZip,
  validateRestoreZip,
  computeNextAutoBackupAt,
  selectBackupsToDelete,
  type VersionMeta,
  type ThumbnailFile,
} from '../src/main/backup.js';

const SCHEMA_V2 = 2;

const sampleVersionMeta: VersionMeta = {
  schema_version: SCHEMA_V2,
  app_version: '0.1.0',
  exported_at: '2026-06-16T00:00:00.000Z',
};

const sampleDb = Buffer.from('SQLite format 3\x00fake-db-data');
const sampleThumbs: ThumbnailFile[] = [
  { relativePath: '1234567890.jpg', data: Buffer.from('jpeg-data-1') },
  { relativePath: '9876543210.jpg', data: Buffer.from('jpeg-data-2') },
];

// ---------------------------------------------------------------------------
// buildBackupZip
// ---------------------------------------------------------------------------

describe('buildBackupZip', () => {
  it('produces a buffer that can be unzipped', () => {
    const zip = buildBackupZip(sampleDb, sampleThumbs, sampleVersionMeta);
    expect(zip.byteLength).toBeGreaterThan(0);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).length).toBeGreaterThan(0);
  });

  it('contains catalogue.db with the supplied content', () => {
    const zip = buildBackupZip(sampleDb, sampleThumbs, sampleVersionMeta);
    const entries = unzipSync(zip);
    expect(entries['catalogue.db']).toBeDefined();
    expect(Buffer.from(entries['catalogue.db']).toString()).toBe(sampleDb.toString());
  });

  it('contains version.json with the supplied meta', () => {
    const zip = buildBackupZip(sampleDb, sampleThumbs, sampleVersionMeta);
    const entries = unzipSync(zip);
    expect(entries['version.json']).toBeDefined();
    const parsed = JSON.parse(strFromU8(entries['version.json'])) as VersionMeta;
    expect(parsed.schema_version).toBe(SCHEMA_V2);
    expect(parsed.app_version).toBe('0.1.0');
    expect(parsed.exported_at).toBe('2026-06-16T00:00:00.000Z');
  });

  it('contains thumbnails under scans/thumbnails/', () => {
    const zip = buildBackupZip(sampleDb, sampleThumbs, sampleVersionMeta);
    const entries = unzipSync(zip);
    expect(entries['scans/thumbnails/1234567890.jpg']).toBeDefined();
    expect(Buffer.from(entries['scans/thumbnails/1234567890.jpg']).toString()).toBe('jpeg-data-1');
    expect(entries['scans/thumbnails/9876543210.jpg']).toBeDefined();
  });

  it('works with zero thumbnails', () => {
    const zip = buildBackupZip(sampleDb, [], sampleVersionMeta);
    const entries = unzipSync(zip);
    expect(entries['catalogue.db']).toBeDefined();
    expect(entries['version.json']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// validateRestoreZip
// ---------------------------------------------------------------------------

describe('validateRestoreZip', () => {
  it('returns compatible when schema versions match', () => {
    const versionJson = JSON.stringify({ schema_version: 2, app_version: '0.1.0', exported_at: '2026-01-01T00:00:00Z' });
    expect(validateRestoreZip(versionJson, 2)).toBe('compatible');
  });

  it('returns needs-migration when backup schema is older', () => {
    const versionJson = JSON.stringify({ schema_version: 1, app_version: '0.0.1', exported_at: '2025-01-01T00:00:00Z' });
    expect(validateRestoreZip(versionJson, 2)).toBe('needs-migration');
  });

  it('returns incompatible-newer when backup schema is newer', () => {
    const versionJson = JSON.stringify({ schema_version: 99, app_version: '2.0.0', exported_at: '2030-01-01T00:00:00Z' });
    expect(validateRestoreZip(versionJson, 2)).toBe('incompatible-newer');
  });

  it('handles a schema_version of 0 (empty/initial db) as needing migration', () => {
    const versionJson = JSON.stringify({ schema_version: 0, app_version: '0.0.0', exported_at: '2024-01-01T00:00:00Z' });
    expect(validateRestoreZip(versionJson, 2)).toBe('needs-migration');
  });
});

// ---------------------------------------------------------------------------
// computeNextAutoBackupAt
// ---------------------------------------------------------------------------

describe('computeNextAutoBackupAt', () => {
  const epoch = new Date('2026-06-16T12:00:00Z').getTime();

  it('returns null when cadence is on-quit (scheduler handles that separately)', () => {
    expect(computeNextAutoBackupAt('on-quit', null, epoch)).toBeNull();
    expect(computeNextAutoBackupAt('on-quit', epoch - 1000, epoch)).toBeNull();
  });

  it('returns now when lastBackupAt is null (never backed up)', () => {
    expect(computeNextAutoBackupAt('daily', null, epoch)).toBe(epoch);
    expect(computeNextAutoBackupAt('weekly', null, epoch)).toBe(epoch);
    expect(computeNextAutoBackupAt('monthly', null, epoch)).toBe(epoch);
  });

  it('returns null when daily backup was less than 24 h ago', () => {
    const lastAt = epoch - 23 * 60 * 60 * 1000;
    expect(computeNextAutoBackupAt('daily', lastAt, epoch)).toBeNull();
  });

  it('returns now when daily backup was more than 24 h ago', () => {
    const lastAt = epoch - 25 * 60 * 60 * 1000;
    expect(computeNextAutoBackupAt('daily', lastAt, epoch)).toBe(epoch);
  });

  it('returns null when weekly backup was less than 7 days ago', () => {
    const lastAt = epoch - 6 * 24 * 60 * 60 * 1000;
    expect(computeNextAutoBackupAt('weekly', lastAt, epoch)).toBeNull();
  });

  it('returns now when weekly backup was more than 7 days ago', () => {
    const lastAt = epoch - 8 * 24 * 60 * 60 * 1000;
    expect(computeNextAutoBackupAt('weekly', lastAt, epoch)).toBe(epoch);
  });

  it('returns null when monthly backup was less than 30 days ago', () => {
    const lastAt = epoch - 29 * 24 * 60 * 60 * 1000;
    expect(computeNextAutoBackupAt('monthly', lastAt, epoch)).toBeNull();
  });

  it('returns now when monthly backup was more than 30 days ago', () => {
    const lastAt = epoch - 31 * 24 * 60 * 60 * 1000;
    expect(computeNextAutoBackupAt('monthly', lastAt, epoch)).toBe(epoch);
  });
});

// ---------------------------------------------------------------------------
// selectBackupsToDelete (pruning)
// ---------------------------------------------------------------------------

describe('selectBackupsToDelete', () => {
  it('returns empty when fewer files than retain count', () => {
    const files = ['backup-2026-01-01.zip', 'backup-2026-01-02.zip'];
    expect(selectBackupsToDelete(files, 4)).toEqual([]);
  });

  it('returns empty when exactly at retain count', () => {
    const files = [
      'backup-2026-01-01.zip',
      'backup-2026-01-02.zip',
      'backup-2026-01-03.zip',
      'backup-2026-01-04.zip',
    ];
    expect(selectBackupsToDelete(files, 4)).toEqual([]);
  });

  it('returns the oldest files when over retain count', () => {
    const files = [
      'backup-2026-01-05.zip',
      'backup-2026-01-03.zip',
      'backup-2026-01-01.zip',
      'backup-2026-01-04.zip',
      'backup-2026-01-02.zip',
    ];
    const toDelete = selectBackupsToDelete(files, 4);
    // Should delete 1 file (the oldest by name sort)
    expect(toDelete).toHaveLength(1);
    expect(toDelete[0]).toBe('backup-2026-01-01.zip');
  });

  it('returns multiple files when far over retain count', () => {
    const files = ['f5.zip', 'f1.zip', 'f2.zip', 'f3.zip', 'f4.zip', 'f6.zip'];
    const toDelete = selectBackupsToDelete(files, 4);
    expect(toDelete).toHaveLength(2);
    expect(toDelete).toContain('f1.zip');
    expect(toDelete).toContain('f2.zip');
  });

  it('returns empty for empty list', () => {
    expect(selectBackupsToDelete([], 4)).toEqual([]);
  });

  it('prunes down to retain count of 1', () => {
    const files = ['a.zip', 'b.zip', 'c.zip'];
    const toDelete = selectBackupsToDelete(files, 1);
    expect(toDelete).toHaveLength(2);
    expect(toDelete).toContain('a.zip');
    expect(toDelete).toContain('b.zip');
    expect(toDelete).not.toContain('c.zip');
  });
});
