import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { computePHash } from './phash.js';
import {
  planSetCropDownload,
  type DownloadTarget,
} from './art-crop-planner.js';
import type { ScryfallIndexDb, SetDownloadStatus } from './scryfall-index.js';
import type { HttpError } from './scryfall-bulk.js';

export interface DecodedImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface ArtCropDeps {
  index: ScryfallIndexDb;
  cropsDir: string;
  fetchImage: (url: string) => Promise<Buffer>;
  decodeImage: (buffer: Buffer) => DecodedImage;
  rateLimit?: () => Promise<void>;
  maxRetries?: number;
  retrySleep?: (ms: number) => Promise<void>;
}

export interface SetCropProgressEvent {
  setCode: string;
  downloaded: number;
  failed: number;
  total: number;
  status: SetDownloadStatus;
}

export class ArtCropOrchestrator extends EventEmitter {
  private readonly active = new Set<string>();

  constructor(private readonly deps: ArtCropDeps) {
    super();
  }

  isActive(setCode: string): boolean {
    return this.active.has(setCode);
  }

  async startSetDownload(setCode: string): Promise<void> {
    if (this.active.has(setCode)) {
      throw new Error(`Set ${setCode} is already downloading`);
    }
    this.active.add(setCode);
    try {
      const rows = this.deps.index.listSetCropRows(setCode);
      const plan = planSetCropDownload(setCode, rows);

      if (plan.kind === 'empty' || plan.kind === 'complete') {
        this.deps.index.setSetDownloadStatus(setCode, 'complete', true);
        this.emitProgress(setCode, 0, 0, 0, 'complete');
        return;
      }

      this.deps.index.setSetDownloadStatus(setCode, 'downloading', false);
      this.emitProgress(setCode, 0, 0, plan.cards.length, 'downloading');

      let downloaded = 0;
      let failed = 0;
      for (const target of plan.cards) {
        try {
          await this.processCard(setCode, target);
          downloaded++;
        } catch {
          failed++;
        }
        this.emitProgress(
          setCode,
          downloaded,
          failed,
          plan.cards.length,
          'downloading',
        );
      }

      const allHashed = this.isFullyHashed(setCode);
      const finalStatus: SetDownloadStatus = allHashed
        ? 'complete'
        : failed > 0
          ? 'error'
          : 'complete';
      this.deps.index.setSetDownloadStatus(setCode, finalStatus, allHashed);
      this.emitProgress(setCode, downloaded, failed, plan.cards.length, finalStatus);
    } finally {
      this.active.delete(setCode);
    }
  }

  async removeSetCrops(setCode: string): Promise<void> {
    const setDir = join(this.deps.cropsDir, setCode);
    rmSync(setDir, { recursive: true, force: true });
    this.deps.index.clearSetCrops(setCode);
    this.deps.index.setSetDownloadStatus(setCode, 'none', false);
    this.emitProgress(setCode, 0, 0, 0, 'none');
  }

  private async processCard(setCode: string, target: DownloadTarget): Promise<void> {
    if (this.deps.rateLimit) await this.deps.rateLimit();
    const buffer = await this.fetchWithRetry(target.image_art_crop_url);
    const decoded = this.deps.decodeImage(buffer);
    const phash = computePHash(decoded.rgba, decoded.width, decoded.height);
    const setDir = join(this.deps.cropsDir, setCode);
    mkdirSync(setDir, { recursive: true });
    const path = join(setDir, `${target.scryfall_id}.jpg`);
    writeFileSync(path, buffer);
    this.deps.index.updateCardCrop(target.scryfall_id, phash, path);
  }

  private async fetchWithRetry(url: string): Promise<Buffer> {
    const maxRetries = this.deps.maxRetries ?? 3;
    const sleep = this.deps.retrySleep ?? defaultSleep;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.deps.fetchImage(url);
      } catch (err) {
        lastErr = err;
        const status = (err as HttpError | undefined)?.status;
        if (status !== 429) throw err;
        if (attempt === maxRetries) throw err;
        const retryAfter = (err as HttpError).retryAfterMs;
        await sleep(retryAfter ?? 1000 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  private isFullyHashed(setCode: string): boolean {
    const rows = this.deps.index.listSetCropRows(setCode);
    if (rows.length === 0) return true;
    return rows.every((r) =>
      // Cards without an art_crop URL can never be hashed; don't block completion on them.
      r.image_art_crop_url == null ? true : r.phash != null && r.art_crop_path != null,
    );
  }

  private emitProgress(
    setCode: string,
    downloaded: number,
    failed: number,
    total: number,
    status: SetDownloadStatus,
  ): void {
    const event: SetCropProgressEvent = { setCode, downloaded, failed, total, status };
    this.emit('progress', event);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
