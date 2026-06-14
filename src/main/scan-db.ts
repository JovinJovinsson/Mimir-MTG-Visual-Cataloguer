import type { Database } from 'better-sqlite3';
import type { ScansInsert, ScanForRenderer } from '../shared/types.js';

interface ScanRow {
  id: number;
  captured_at: number;
  thumbnail_path: string | null;
}

export interface ScanDb {
  insertScan(row: ScansInsert): number;
  listRecentScans(limit: number): ScanForRenderer[];
}

export function openScanDb(db: Database): ScanDb {
  const insertStmt = db.prepare(`
    INSERT INTO scans
      (card_id, captured_at, thumbnail_path, phash, confidence_score, inferences_json, needed_manual_review)
    VALUES
      (@card_id, @captured_at, @thumbnail_path, @phash, @confidence_score, @inferences_json, @needed_manual_review)
  `);

  const listStmt = db.prepare<[number], ScanRow>(`
    SELECT id, captured_at, thumbnail_path
    FROM scans
    ORDER BY captured_at DESC
    LIMIT ?
  `);

  return {
    insertScan(row: ScansInsert): number {
      const info = insertStmt.run(row);
      return Number(info.lastInsertRowid);
    },

    listRecentScans(limit: number): ScanForRenderer[] {
      return listStmt.all(limit).map((r) => ({
        id: r.id,
        captured_at: r.captured_at,
        thumbnail_path: r.thumbnail_path,
      }));
    },
  };
}
