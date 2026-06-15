import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import {
  getTopNCandidates,
  MATCH_THRESHOLD,
  SILENT_ACCEPT_THRESHOLD,
  type RecognitionIndex,
  type HashedCardWithCrop,
} from './recognition-pipeline.js';
import { computePHash } from './phash.js';
import type { ScanDb } from './scan-db.js';
import type { CatalogueDb } from './database.js';
import type { ReviewQueueDb } from './review-queue-db.js';

export interface QueueItem {
  scanId: number;
  thumbnailPath: string;
  capturedAt: number;
}

export interface ScanQueueDepthEvent {
  depth: number;
  etaMs: number | null;
}

export interface RecognitionIndexWithCrops extends RecognitionIndex {
  getAllHashedCardsWithCrop(): HashedCardWithCrop[];
}

export interface ProcessingQueueDeps {
  decodeImage(buffer: Buffer): { rgba: Uint8Array; width: number; height: number };
  index: RecognitionIndexWithCrops;
  scanDb: ScanDb;
  catalogueDb: CatalogueDb;
  reviewQueueDb: ReviewQueueDb;
  onReviewCountChanged?: () => void;
}

export class ProcessingQueue extends EventEmitter {
  private readonly items: QueueItem[] = [];
  private running = false;
  private avgProcessMs = 500;

  constructor(private readonly deps: ProcessingQueueDeps) {
    super();
  }

  enqueue(item: QueueItem): void {
    this.items.push(item);
    this.emitDepth();
    if (!this.running) this.drain();
  }

  get depth(): number {
    return this.items.length;
  }

  private emitDepth(): void {
    const depth = this.items.length;
    const etaMs = depth > 0 ? depth * this.avgProcessMs : null;
    this.emit('depth', { depth, etaMs } satisfies ScanQueueDepthEvent);
  }

  private drain(): void {
    this.running = true;
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    while (this.items.length > 0) {
      const item = this.items.shift()!;
      const t0 = Date.now();
      await this.processItem(item);
      const elapsed = Date.now() - t0;
      this.avgProcessMs = this.avgProcessMs * 0.8 + elapsed * 0.2;
      this.emitDepth();
    }
    this.running = false;
    this.emitDepth();
  }

  private async processItem(item: QueueItem): Promise<void> {
    const { decodeImage, index, scanDb, catalogueDb, reviewQueueDb, onReviewCountChanged } = this.deps;

    let decoded: { rgba: Uint8Array; width: number; height: number };
    try {
      const buffer = await readFile(item.thumbnailPath);
      decoded = decodeImage(buffer);
    } catch {
      scanDb.updateScanRecognition(item.scanId, {
        phash: null,
        confidenceScore: null,
        cardId: null,
        inferencesJson: null,
        neededManualReview: 1,
      });
      return;
    }

    let phash: string;
    try {
      phash = computePHash(decoded.rgba, decoded.width, decoded.height);
    } catch {
      scanDb.updateScanRecognition(item.scanId, {
        phash: null,
        confidenceScore: null,
        cardId: null,
        inferencesJson: null,
        neededManualReview: 1,
      });
      return;
    }

    const allCards = index.getAllHashedCardsWithCrop();
    const candidates = getTopNCandidates(phash, allCards, 5);
    const best = candidates[0];

    const confidenceScore = best ? 1 - best.hammingDistance / 64 : 0;

    if (!best || best.hammingDistance > MATCH_THRESHOLD) {
      // No confident match → unknown_card review
      scanDb.updateScanRecognition(item.scanId, {
        phash,
        confidenceScore,
        cardId: null,
        inferencesJson: null,
        neededManualReview: 1,
      });
      reviewQueueDb.insertReviewItem({
        scanId: item.scanId,
        reason: 'unknown_card',
        candidatesJson: JSON.stringify(candidates),
        createdAt: item.capturedAt,
      });
      onReviewCountChanged?.();
      return;
    }

    if (best.hammingDistance > SILENT_ACCEPT_THRESHOLD) {
      // Within match threshold but not a clear winner → ambiguous review
      scanDb.updateScanRecognition(item.scanId, {
        phash,
        confidenceScore,
        cardId: null,
        inferencesJson: null,
        neededManualReview: 1,
      });
      reviewQueueDb.insertReviewItem({
        scanId: item.scanId,
        reason: 'ambiguous_identity',
        candidatesJson: JSON.stringify(candidates),
        createdAt: item.capturedAt,
      });
      onReviewCountChanged?.();
      return;
    }

    // Silent accept
    const addResult = catalogueDb.addCard({
      scryfall_id: best.scryfallId,
      name: best.name,
      set_code: best.setCode,
      set_name: best.setName,
      collector_number: best.collectorNumber,
      foil: 'normal',
      condition: 'NM',
      language: 'EN',
      price_usd: best.priceUsd,
    });

    const inferencesJson = JSON.stringify({ foil: 'normal', condition: 'NM', language: 'EN' });
    scanDb.updateScanRecognition(item.scanId, {
      phash,
      confidenceScore,
      cardId: addResult.id,
      inferencesJson,
      neededManualReview: 0,
    });
  }
}
