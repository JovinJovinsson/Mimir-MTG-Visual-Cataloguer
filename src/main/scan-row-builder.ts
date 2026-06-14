import type { ScansInsert } from '../shared/types.js';

export interface CaptureInput {
  thumbnailPath: string;
  capturedAt: number;
}

export function buildScanRow(input: CaptureInput): ScansInsert {
  return {
    card_id: null,
    captured_at: input.capturedAt,
    thumbnail_path: input.thumbnailPath,
    phash: null,
    confidence_score: null,
    inferences_json: null,
    needed_manual_review: 0,
  };
}
