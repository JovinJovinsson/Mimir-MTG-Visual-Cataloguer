import { EventEmitter } from 'node:events';
import {
  planScryfallBootstrap,
  planBulkIngest,
  type ScryfallBulkCard,
  type UserSelection,
} from './scryfall-bootstrap.js';
import type { ScryfallIndexDb } from './scryfall-index.js';
import type { BulkDataManifest } from './scryfall-bulk.js';
import { fetchStandardSetCodes } from './scryfall.js';

export type BootstrapPhase =
  | 'idle'
  | 'fetching-manifest'
  | 'downloading'
  | 'ingesting'
  | 'done'
  | 'error';

export interface BootstrapStatus {
  phase: BootstrapPhase;
  cardCount: number;
  setCount: number;
  scannerGateOpen: boolean;
  totalBytes: number | null;
  downloadedBytes: number;
  ingestedCards: number;
  totalCards: number | null;
  error: string | null;
  updatedAt: number;
}

export type DownloadProgressFn = (downloadedBytes: number, totalBytes: number | null) => void;

export interface BootstrapDeps {
  index: ScryfallIndexDb;
  fetchManifest: (bulkType: 'default_cards') => Promise<BulkDataManifest>;
  fetchBulk: (downloadUri: string, onProgress: DownloadProgressFn) => Promise<ScryfallBulkCard[]>;
  fetchStandardSetCodes?: () => Promise<string[]>;
  now?: () => number;
  batchSize?: number;
}

// Emit at most one progress event per this many bytes to avoid flooding IPC.
const PROGRESS_EMIT_INTERVAL_BYTES = 1024 * 1024; // 1 MB

export class BootstrapOrchestrator extends EventEmitter {
  private phase: BootstrapPhase = 'idle';
  private error: string | null = null;
  private totalBytes: number | null = null;
  private downloadedBytes = 0;
  private ingestedCards = 0;
  private totalCards: number | null = null;
  private running = false;

  constructor(private readonly deps: BootstrapDeps) {
    super();
  }

  status(): BootstrapStatus {
    const indexState = this.deps.index.getIndexState();
    return {
      phase: this.phase,
      cardCount: indexState.cardCount,
      setCount: indexState.setCount,
      scannerGateOpen: indexState.cardCount > 0,
      totalBytes: this.totalBytes,
      downloadedBytes: this.downloadedBytes,
      ingestedCards: this.ingestedCards,
      totalCards: this.totalCards,
      error: this.error,
      updatedAt: this.now(),
    };
  }

  async start(selection: UserSelection): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = null;
    this.ingestedCards = 0;
    this.totalCards = null;
    this.totalBytes = null;
    this.downloadedBytes = 0;

    try {
      // Resolve standard set codes before planning (network call)
      let resolvedSelection = selection;
      if (selection !== 'full' && selection.kind === 'standard') {
        const standardFetch = this.deps.fetchStandardSetCodes ?? fetchStandardSetCodes;
        const standardSetCodes = await standardFetch();
        resolvedSelection = { kind: 'standard', standardSetCodes };
      }

      const plan = planScryfallBootstrap(resolvedSelection, this.deps.index.getIndexState());
      if (plan.kind === 'skip') {
        this.setPhase('done');
        return;
      }

      this.setPhase('fetching-manifest');
      const manifest = await this.deps.fetchManifest(plan.bulkType);
      this.totalBytes = manifest.size ?? null;

      this.setPhase('downloading');
      let lastEmitAt = 0;
      const cards = await this.deps.fetchBulk(manifest.download_uri, (downloaded, total) => {
        this.downloadedBytes = downloaded;
        if (total != null) this.totalBytes = total;
        if (downloaded - lastEmitAt >= PROGRESS_EMIT_INTERVAL_BYTES) {
          lastEmitAt = downloaded;
          this.emit('progress', this.status());
        }
      });
      this.totalCards = cards.length;

      this.setPhase('ingesting');
      const batches = planBulkIngest(cards, {
        batchSize: this.deps.batchSize ?? 1000,
        allowedSets: plan.allowedSets,
      });
      for (const batch of batches) {
        this.deps.index.ingestBatches([batch]);
        this.ingestedCards += batch.cards.length;
        this.emit('progress', this.status());
      }
      this.deps.index.markBulkFetched(this.now());

      this.setPhase('done');
    } catch (err) {
      if (err instanceof Error) {
        this.error = err.message || err.name || 'Download failed';
      } else {
        this.error = String(err);
      }
      console.error('[bootstrap] error:', err);
      this.setPhase('error');
    } finally {
      this.running = false;
    }
  }

  async forceStart(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = null;
    this.ingestedCards = 0;
    this.totalCards = null;
    this.totalBytes = null;
    this.downloadedBytes = 0;

    try {
      this.setPhase('fetching-manifest');
      const manifest = await this.deps.fetchManifest('default_cards');
      this.totalBytes = manifest.size ?? null;

      this.setPhase('downloading');
      let lastEmitAt = 0;
      const cards = await this.deps.fetchBulk(manifest.download_uri, (downloaded, total) => {
        this.downloadedBytes = downloaded;
        if (total != null) this.totalBytes = total;
        if (downloaded - lastEmitAt >= PROGRESS_EMIT_INTERVAL_BYTES) {
          lastEmitAt = downloaded;
          this.emit('progress', this.status());
        }
      });
      this.totalCards = cards.length;

      this.setPhase('ingesting');
      const batches = planBulkIngest(cards, { batchSize: this.deps.batchSize ?? 1000 });
      for (const batch of batches) {
        this.deps.index.ingestBatches([batch]);
        this.ingestedCards += batch.cards.length;
        this.emit('progress', this.status());
      }
      this.deps.index.markBulkFetched(this.now());

      this.setPhase('done');
    } catch (err) {
      if (err instanceof Error) {
        this.error = err.message || err.name || 'Refresh failed';
      } else {
        this.error = String(err);
      }
      console.error('[bootstrap] force refresh error:', err);
      this.setPhase('error');
    } finally {
      this.running = false;
    }
  }

  private setPhase(p: BootstrapPhase): void {
    this.phase = p;
    this.emit('progress', this.status());
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}
