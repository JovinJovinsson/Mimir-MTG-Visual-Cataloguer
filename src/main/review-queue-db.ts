import type { Database } from 'better-sqlite3';
import type { ReviewCandidate, ReviewItemDto, ReviewReason } from '../shared/types.js';

export type { ReviewReason };

export interface ReviewQueueInsert {
  scanId: number | null;
  reason: ReviewReason;
  candidatesJson: string;
  createdAt: number;
}

interface ReviewQueueItemRow {
  id: number;
  scan_id: number | null;
  reason: ReviewReason;
  candidates_json: string;
  thumbnail_path: string | null;
  captured_at: number;
  created_at: number;
}

interface CountRow {
  count: number;
}

export interface ReviewQueueDb {
  insertReviewItem(item: ReviewQueueInsert): number;
  getPendingCount(): number;
  listPendingItems(limit: number): ReviewItemDto[];
  getItemById(id: number): ReviewItemDto | null;
  resolveItem(id: number, scryfallId: string): void;
  dismissItem(id: number): void;
  skipItem(id: number): void;
}

export function openReviewQueueDb(db: Database): ReviewQueueDb {
  const insertStmt = db.prepare(`
    INSERT INTO review_queue (scan_id, reason, status, candidates_json, created_at)
    VALUES (@scan_id, @reason, 'pending', @candidates_json, @created_at)
  `);

  const countStmt = db.prepare<[], CountRow>(`
    SELECT COUNT(*) AS count FROM review_queue WHERE status = 'pending'
  `);

  const listPendingStmt = db.prepare<[number], ReviewQueueItemRow>(`
    SELECT rq.id, rq.scan_id, rq.reason, rq.candidates_json, rq.created_at,
           s.thumbnail_path, COALESCE(s.captured_at, rq.created_at) AS captured_at
    FROM review_queue rq
    LEFT JOIN scans s ON s.id = rq.scan_id
    WHERE rq.status = 'pending'
    ORDER BY rq.created_at ASC
    LIMIT ?
  `);

  const getByIdStmt = db.prepare<[number], ReviewQueueItemRow>(`
    SELECT rq.id, rq.scan_id, rq.reason, rq.candidates_json, rq.created_at,
           s.thumbnail_path, COALESCE(s.captured_at, rq.created_at) AS captured_at
    FROM review_queue rq
    LEFT JOIN scans s ON s.id = rq.scan_id
    WHERE rq.id = ?
  `);

  const resolveStmt = db.prepare(`
    UPDATE review_queue
    SET status = 'resolved', resolved_scryfall_id = @scryfall_id, resolved_at = @now
    WHERE id = @id
  `);

  const dismissStmt = db.prepare(`
    UPDATE review_queue SET status = 'dismissed', resolved_at = @now WHERE id = @id
  `);

  const skipStmt = db.prepare(`
    UPDATE review_queue SET status = 'skipped', resolved_at = @now WHERE id = @id
  `);

  function rowToDto(row: ReviewQueueItemRow): ReviewItemDto {
    return {
      id: row.id,
      scanId: row.scan_id,
      reason: row.reason,
      candidates: JSON.parse(row.candidates_json) as ReviewCandidate[],
      thumbnailPath: row.thumbnail_path,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
    };
  }

  return {
    insertReviewItem(item: ReviewQueueInsert): number {
      const info = insertStmt.run({
        scan_id: item.scanId,
        reason: item.reason,
        candidates_json: item.candidatesJson,
        created_at: item.createdAt,
      });
      return Number(info.lastInsertRowid);
    },

    getPendingCount(): number {
      return countStmt.get()?.count ?? 0;
    },

    listPendingItems(limit: number): ReviewItemDto[] {
      return listPendingStmt.all(limit).map(rowToDto);
    },

    getItemById(id: number): ReviewItemDto | null {
      const row = getByIdStmt.get(id);
      return row ? rowToDto(row) : null;
    },

    resolveItem(id: number, scryfallId: string): void {
      resolveStmt.run({ id, scryfall_id: scryfallId, now: Date.now() });
    },

    dismissItem(id: number): void {
      dismissStmt.run({ id, now: Date.now() });
    },

    skipItem(id: number): void {
      skipStmt.run({ id, now: Date.now() });
    },
  };
}
