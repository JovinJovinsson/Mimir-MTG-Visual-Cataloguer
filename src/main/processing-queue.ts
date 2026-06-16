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
import {
  inferFoil,
  inferLanguage,
  inferPrice,
  classifyInference,
  DEFAULT_THRESHOLDS,
  type EtchedContext,
} from './field-inference.js';
import { detectAmbiguity } from './ambiguity-detector.js';
import { planCatalogueAdditionWithInferences, type FieldInferences } from './planner.js';
import type { ScanModePreset } from '../shared/types.js';
import type { ScanDb } from './scan-db.js';
import type { CatalogueDb } from './database.js';
import type { ReviewQueueDb } from './review-queue-db.js';

export interface QueueItem {
  scanId: number;
  thumbnailPath: string;
  capturedAt: number;
  preset?: ScanModePreset;
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
    const preset = item.preset;

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
      // Hash only the art region so our pHash is comparable to the art-crop
      // phashes stored in the DB (which are computed from Scryfall art_crop images).
      // MTG art box spans roughly x:5-95%, y:10-53% of the card face.
      const art = cropRgba(
        decoded.rgba, decoded.width, decoded.height,
        Math.round(decoded.width * 0.05),
        Math.round(decoded.height * 0.10),
        Math.round(decoded.width * 0.95),
        Math.round(decoded.height * 0.53),
      );
      phash = computePHash(art.rgba, art.width, art.height);
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

    // Compute foil pixel inference early so its glare signal can feed ambiguity detection.
    // Look up the full card data first to provide etched context.
    const bestCard = allCards.find((c) => c.scryfall_id === best.scryfallId);
    const finishes = bestCard?.finishes_json
      ? (JSON.parse(bestCard.finishes_json) as string[]).map((f) =>
          f === 'nonfoil' ? 'normal' : f,
        )
      : [];
    const etchedCtx: EtchedContext = {
      finishes: finishes as import('../shared/types.js').Foil[],
      priceUsdEtched: bestCard?.price_usd_etched ?? null,
    };

    const foilResult = inferFoil(decoded.rgba, decoded.width, decoded.height, etchedCtx);
    // Glare signal: confidence when foil/etched was detected, else 0
    const glareSignal = foilResult.value !== 'normal' ? foilResult.confidence : 0;

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

    // Even within the silent-accept zone, high foil glare with close candidates is unreliable
    if (detectAmbiguity(candidates, glareSignal) === 'ambiguous_identity') {
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

    const langResult = inferLanguage(bestCard?.lang ?? null);
    const priceResult = inferPrice(
      best.priceUsd,
      bestCard?.price_usd_foil ?? null,
      foilResult.value,
      bestCard?.price_usd_etched ?? null,
    );

    const inferences: FieldInferences = {
      foil: foilResult,
      language: langResult,
      price: priceResult,
    };

    // Destination collection: use preset when explicitly set, otherwise fall back to inbox
    const collectionId =
      preset && preset.collectionId !== 'inbox'
        ? preset.collectionId
        : catalogueDb.inboxCollectionId();

    // Resolve effective field values for the dedup lookup (preset overrides inference)
    const effectiveFoil = preset && preset.foil !== 'auto' ? preset.foil : foilResult.value;
    const effectiveLang = preset && preset.language !== 'auto' ? preset.language : langResult.value;
    const effectiveCondition = preset && preset.condition !== 'auto' ? preset.condition : 'NM';

    const existing = catalogueDb.findCardByScryfallId(
      best.scryfallId,
      effectiveFoil,
      effectiveCondition,
      effectiveLang,
      collectionId,
    );

    const addAction = planCatalogueAdditionWithInferences(
      existing,
      {
        scryfall_id: best.scryfallId,
        name: best.name,
        set_code: best.setCode,
        set_name: best.setName,
        collector_number: best.collectorNumber,
        collection_id: collectionId,
        now: item.capturedAt,
      },
      inferences,
      DEFAULT_THRESHOLDS,
      preset,
    );

    const hasFlagged = addAction.kind === 'insert' && addAction.row.needs_review === 1;

    const cardId = catalogueDb.executeAction(addAction);

    const inferencesJson = JSON.stringify({
      foil: foilResult.value,
      foil_confidence: foilResult.confidence,
      language: langResult.value,
      language_confidence: langResult.confidence,
    });

    scanDb.updateScanRecognition(item.scanId, {
      phash,
      confidenceScore,
      cardId,
      inferencesJson,
      neededManualReview: hasFlagged ? 1 : 0,
    });

    // Insert a low_confidence_field review queue entry when fields are uncertain
    if (hasFlagged && addAction.kind === 'insert') {
      const reasons: string[] = JSON.parse(addAction.row.review_reasons ?? '[]') as string[];
      const flaggedFields = reasons
        .filter((r) => r.startsWith('low_confidence_field:'))
        .map((r) => r.split(':')[1]);

      const candidate = {
        scryfallId: best.scryfallId,
        name: best.name,
        setCode: best.setCode,
        setName: best.setName,
        collectorNumber: best.collectorNumber,
        priceUsd: priceResult.value,
        hammingDistance: best.hammingDistance,
        artCropPath: best.artCropPath ?? null,
      };

      const inferredValues: Record<string, string> = {};
      for (const field of flaggedFields) {
        if (field === 'foil') inferredValues['foil'] = foilResult.value;
        if (field === 'language') inferredValues['language'] = langResult.value;
      }

      reviewQueueDb.insertReviewItem({
        scanId: item.scanId,
        reason: 'low_confidence_field',
        candidatesJson: JSON.stringify({
          candidates: [candidate],
          flaggedFields,
          cardId,
          inferredValues,
        }),
        createdAt: item.capturedAt,
      });
      onReviewCountChanged?.();
    }
  }
}

function cropRgba(
  src: Uint8Array, srcW: number, srcH: number,
  x1: number, y1: number, x2: number, y2: number,
): { rgba: Uint8Array; width: number; height: number } {
  const cropW = Math.max(1, x2 - x1);
  const cropH = Math.max(1, y2 - y1);
  const dst = new Uint8Array(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    const srcRow = ((y1 + y) * srcW + x1) * 4;
    dst.set(src.subarray(srcRow, srcRow + cropW * 4), y * cropW * 4);
  }
  return { rgba: dst, width: cropW, height: cropH };
}
