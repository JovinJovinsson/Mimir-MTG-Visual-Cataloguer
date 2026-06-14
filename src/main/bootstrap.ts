import { EventEmitter } from 'node:events';
import {
  planScryfallBootstrap,
  planBulkIngest,
  type ScryfallBulkCard,
  type UserSelection,
} from './scryfall-bootstrap.js';
import type { ScryfallIndexDb } from './scryfall-index.js';
import type { BulkDataManifest } from './scryfall-bulk.js';

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
  ingestedCards: number;
  totalCards: number | null;
  error: string | null;
  updatedAt: number;
}

export interface BootstrapDeps {
  index: ScryfallIndexDb;
  fetchManifest: (bulkType: 'default_cards') => Promise<BulkDataManifest>;
  fetchBulk: (downloadUri: string) => Promise<ScryfallBulkCard[]>;
  now?: () => number;
  batchSize?: number;
}

export class BootstrapOrchestrator extends EventEmitter {
  private phase: BootstrapPhase = 'idle';
  private error: string | null = null;
  private totalBytes: number | null = null;
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

    try {
      const plan = planScryfallBootstrap(selection, this.deps.index.getIndexState());
      if (plan.kind === 'skip') {
        this.setPhase('done');
        return;
      }

      this.setPhase('fetching-manifest');
      const manifest = await this.deps.fetchManifest(plan.bulkType);
      this.totalBytes = manifest.size ?? null;

      this.setPhase('downloading');
      const cards = await this.deps.fetchBulk(manifest.download_uri);
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
      this.error = err instanceof Error ? err.message : String(err);
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
