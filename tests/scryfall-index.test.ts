import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openScryfallIndexDb,
  defaultScryfallIndexPath,
  type ScryfallIndexDb,
} from '../src/main/scryfall-index.js';
import { planBulkIngest, type ScryfallBulkCard } from '../src/main/scryfall-bootstrap.js';

let tmpDir: string;
let db: ScryfallIndexDb;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mimir-index-'));
  db = openScryfallIndexDb(defaultScryfallIndexPath(tmpDir));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const sample: ScryfallBulkCard[] = [
  {
    id: 'sf-bolt',
    name: 'Lightning Bolt',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    prices: { usd: '5.00' },
  },
  {
    id: 'sf-lotus',
    name: 'Black Lotus',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '232',
    prices: { usd: '50000.00' },
  },
  {
    id: 'sf-shock',
    name: 'Shock',
    set: 'm10',
    set_name: 'Magic 2010',
    collector_number: '152',
  },
];

describe('openScryfallIndexDb', () => {
  it('creates the scryfall-index directory and DB file under userData', () => {
    const path = defaultScryfallIndexPath(tmpDir);
    expect(path).toMatch(/scryfall-index[/\\]scryfall_index\.db$/);
    expect(existsSync(path)).toBe(true);
  });

  it('starts empty with no cards or sets', () => {
    const state = db.getIndexState();
    expect(state.hasIndex).toBe(true);
    expect(state.cardCount).toBe(0);
    expect(state.setCount).toBe(0);
    expect(state.bulkDataLastFetchedAt).toBeNull();
  });

  it('ingests insert batches and reports populated state', () => {
    const batches = planBulkIngest(sample);
    db.ingestBatches(batches);
    db.markBulkFetched(1_700_000_000);

    const state = db.getIndexState();
    expect(state.cardCount).toBe(3);
    expect(state.setCount).toBe(2);
    expect(state.bulkDataLastFetchedAt).toBe(1_700_000_000);
  });

  it('autocompletes by name prefix (case-insensitive)', () => {
    db.ingestBatches(planBulkIngest(sample));
    const hits = db.autocompleteByName('light', 10);
    expect(hits.map((h) => h.name)).toContain('Lightning Bolt');
  });

  it('returns multiple printings of the same name', () => {
    const moreSample: ScryfallBulkCard[] = [
      ...sample,
      {
        id: 'sf-bolt-m10',
        name: 'Lightning Bolt',
        set: 'm10',
        set_name: 'Magic 2010',
        collector_number: '146',
      },
    ];
    db.ingestBatches(planBulkIngest(moreSample));
    const hits = db.autocompleteByName('lightning bolt', 10);
    const boltHits = hits.filter((h) => h.name === 'Lightning Bolt');
    expect(boltHits.length).toBeGreaterThanOrEqual(2);
  });

  it('caps autocomplete results at the requested limit', () => {
    const many: ScryfallBulkCard[] = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      name: `Forest Walker ${i}`,
      set: 'tst',
      set_name: 'Test',
      collector_number: String(i),
    }));
    db.ingestBatches(planBulkIngest(many));
    const hits = db.autocompleteByName('forest', 5);
    expect(hits.length).toBe(5);
  });

  it('upserts rather than duplicates on re-ingest of the same card', () => {
    db.ingestBatches(planBulkIngest(sample));
    db.ingestBatches(planBulkIngest(sample));
    expect(db.getIndexState().cardCount).toBe(3);
  });

  it('persists data across reopen', () => {
    db.ingestBatches(planBulkIngest(sample));
    const path = defaultScryfallIndexPath(tmpDir);
    db.close();
    db = openScryfallIndexDb(path);
    expect(db.getIndexState().cardCount).toBe(3);
  });

  it('fetches a card by scryfall_id', () => {
    db.ingestBatches(planBulkIngest(sample));
    const card = db.getCardByScryfallId('sf-bolt');
    expect(card?.name).toBe('Lightning Bolt');
    expect(card?.set_code).toBe('lea');
  });
});
