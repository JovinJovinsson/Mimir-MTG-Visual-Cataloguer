import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { recognizeCard, type RecognitionIndex } from './recognition-pipeline.js';
import type { ScanDb } from './scan-db.js';
import type { CatalogueDb } from './database.js';

export interface QueueItem {
  scanId: number;
  thumbnailPath: string;
  capturedAt: number;
}

export interface ScanQueueDepthEvent {
  depth: number;
  etaMs: number | null;
}

export interface ProcessingQueueDeps {
  decodeImage(buffer: Buffer): { rgba: Uint8Array; width: number; height: number };
  index: RecognitionIndex;
  scanDb: ScanDb;
  catalogueDb: CatalogueDb;
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
    const { decodeImage, index, scanDb, catalogueDb } = this.deps;

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

    const result = recognizeCard(decoded.rgba, decoded.width, decoded.height, index);

    if (result.kind === 'error') {
      scanDb.updateScanRecognition(item.scanId, {
        phash: null,
        confidenceScore: null,
        cardId: null,
        inferencesJson: null,
        neededManualReview: 1,
      });
      return;
    }

    if (result.kind === 'no-match') {
      scanDb.updateScanRecognition(item.scanId, {
        phash: result.phash,
        confidenceScore: result.confidenceScore,
        cardId: null,
        inferencesJson: null,
        neededManualReview: 1,
      });
      return;
    }

    const { match } = result;
    const addResult = catalogueDb.addCard({
      scryfall_id: match.scryfallId,
      name: match.name,
      set_code: match.setCode,
      set_name: match.setName,
      collector_number: match.collectorNumber,
      foil: 'normal',
      condition: 'NM',
      language: 'EN',
      price_usd: match.priceUsd,
    });

    const inferencesJson = JSON.stringify({ foil: 'normal', condition: 'NM', language: 'EN' });
    scanDb.updateScanRecognition(item.scanId, {
      phash: result.phash,
      confidenceScore: result.confidenceScore,
      cardId: addResult.id,
      inferencesJson,
      neededManualReview: 0,
    });
  }
}
