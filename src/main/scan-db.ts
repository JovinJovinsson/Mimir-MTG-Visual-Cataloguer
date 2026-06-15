import type { Database } from 'better-sqlite3';
import type { ScansInsert, ScanForRenderer } from '../shared/types.js';

interface ScanRow {
  id: number;
  captured_at: number;
  thumbnail_path: string | null;
}

export interface ScanRecognitionUpdate {
  phash: string | null;
  confidenceScore: number | null;
  cardId: number | null;
  inferencesJson: string | null;
  neededManualReview: 0 | 1;
}

export interface ScanDb {
  insertScan(row: ScansInsert): number;
  updateScanRecognition(scanId: number, update: ScanRecognitionUpdate): void;
  listRecentScans(limit: number): ScanForRenderer[];
}

export function openScanDb(db: Database): ScanDb {
  const insertStmt = db.prepare(`
    INSERT INTO scans
      (card_id, captured_at, thumbnail_path, phash, confidence_score, inferences_json, needed_manual_review)
    VALUES
      (@card_id, @captured_at, @thumbnail_path, @phash, @confidence_score, @inferences_json, @needed_manual_review)
  `);

  const updateRecognitionStmt = db.prepare(`
    UPDATE scans
    SET phash = @phash,
        confidence_score = @confidence_score,
        card_id = @card_id,
        inferences_json = @inferences_json,
        needed_manual_review = @needed_manual_review
    WHERE id = @id
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

    updateScanRecognition(scanId: number, update: ScanRecognitionUpdate): void {
      updateRecognitionStmt.run({
        id: scanId,
        phash: update.phash,
        confidence_score: update.confidenceScore,
        card_id: update.cardId,
        inferences_json: update.inferencesJson,
        needed_manual_review: update.neededManualReview,
      });
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
