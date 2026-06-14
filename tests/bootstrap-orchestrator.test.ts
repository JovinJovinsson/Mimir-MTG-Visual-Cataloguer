import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openScryfallIndexDb,
  defaultScryfallIndexPath,
  type ScryfallIndexDb,
} from '../src/main/scryfall-index.js';
import { BootstrapOrchestrator } from '../src/main/bootstrap.js';
import type { ScryfallBulkCard } from '../src/main/scryfall-bootstrap.js';

let tmpDir: string;
let index: ScryfallIndexDb;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mimir-orch-'));
  index = openScryfallIndexDb(defaultScryfallIndexPath(tmpDir));
});

afterEach(() => {
  index.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const sample: ScryfallBulkCard[] = [
  { id: 'a', name: 'A', set: 's', set_name: 'S', collector_number: '1' },
  { id: 'b', name: 'B', set: 's', set_name: 'S', collector_number: '2' },
  { id: 'c', name: 'C', set: 't', set_name: 'T', collector_number: '1' },
];

function fakeManifestFetcher() {
  return async () => ({
    type: 'default_cards',
    download_uri: 'https://x/cards.json',
    updated_at: '2026-06-13T00:00:00Z',
    size: 100,
  });
}

function fakeBulkFetcher(cards: ScryfallBulkCard[]) {
  return async () => cards;
}

describe('BootstrapOrchestrator', () => {
  it('starts idle when index is empty', () => {
    const orch = new BootstrapOrchestrator({
      index,
      fetchManifest: fakeManifestFetcher(),
      fetchBulk: fakeBulkFetcher(sample),
      now: () => 1_700_000_000,
    });
    const status = orch.status();
    expect(status.phase).toBe('idle');
    expect(status.scannerGateOpen).toBe(false);
    expect(status.cardCount).toBe(0);
  });

  it('reports scannerGateOpen=true once cards are present', () => {
    index.ingestBatches([{ sets: [{ code: 's', name: 'S' }], cards: [] }]);
    const populated = openScryfallIndexDb(defaultScryfallIndexPath(tmpDir));
    populated.close();

    const orch = new BootstrapOrchestrator({
      index,
      fetchManifest: fakeManifestFetcher(),
      fetchBulk: fakeBulkFetcher(sample),
      now: () => 1,
    });
    // Manually populate via ingest path to satisfy cardCount > 0
    index.ingestBatches([
      { sets: [], cards: [{
        scryfall_id: 'x', oracle_id: null, name: 'X', set_code: 's', set_name: 'S',
        collector_number: '1', released_at: null, type_line: null, oracle_text: null,
        mana_cost: null, cmc: null, colors_json: null, color_identity_json: null,
        rarity: null, lang: 'en', image_art_crop_url: null, image_normal_url: null,
        image_small_url: null, price_usd: null, price_usd_foil: null,
        finishes_json: '["nonfoil"]', layout: null, is_digital: 0,
        phash: null, art_crop_path: null,
      }] },
    ]);

    expect(orch.status().scannerGateOpen).toBe(true);
  });

  it('runs the full bootstrap and reaches done with cards populated', async () => {
    const events: string[] = [];
    const orch = new BootstrapOrchestrator({
      index,
      fetchManifest: fakeManifestFetcher(),
      fetchBulk: fakeBulkFetcher(sample),
      now: () => 1_700_000_000,
    });
    orch.on('progress', (s) => events.push(s.phase));

    await orch.start('full');

    const final = orch.status();
    expect(final.phase).toBe('done');
    expect(final.cardCount).toBe(3);
    expect(final.scannerGateOpen).toBe(true);
    expect(events).toContain('fetching-manifest');
    expect(events).toContain('downloading');
    expect(events).toContain('ingesting');
    expect(events).toContain('done');
  });

  it('emits error phase when the manifest fetch fails', async () => {
    const orch = new BootstrapOrchestrator({
      index,
      fetchManifest: async () => {
        throw new Error('ENETDOWN: network is down');
      },
      fetchBulk: fakeBulkFetcher(sample),
      now: () => 1,
    });
    await orch.start('full');
    const status = orch.status();
    expect(status.phase).toBe('error');
    expect(status.error).toMatch(/network/i);
    expect(status.scannerGateOpen).toBe(false);
  });

  it('skips when the index is already populated', async () => {
    index.ingestBatches([
      { sets: [{ code: 's', name: 'S' }], cards: [{
        scryfall_id: 'x', oracle_id: null, name: 'X', set_code: 's', set_name: 'S',
        collector_number: '1', released_at: null, type_line: null, oracle_text: null,
        mana_cost: null, cmc: null, colors_json: null, color_identity_json: null,
        rarity: null, lang: 'en', image_art_crop_url: null, image_normal_url: null,
        image_small_url: null, price_usd: null, price_usd_foil: null,
        finishes_json: '["nonfoil"]', layout: null, is_digital: 0,
        phash: null, art_crop_path: null,
      }] },
    ]);

    let manifestCalls = 0;
    const orch = new BootstrapOrchestrator({
      index,
      fetchManifest: async () => {
        manifestCalls++;
        return {
          type: 'default_cards',
          download_uri: 'x',
          updated_at: '',
          size: 0,
        };
      },
      fetchBulk: fakeBulkFetcher(sample),
      now: () => 1,
    });
    await orch.start('full');
    expect(orch.status().phase).toBe('done');
    expect(manifestCalls).toBe(0);
  });

  it('is idempotent when called while already running', async () => {
    let release: () => void = () => {};
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const orch = new BootstrapOrchestrator({
      index,
      fetchManifest: async () => {
        await blocker;
        return { type: 'default_cards', download_uri: 'x', updated_at: '', size: 0 };
      },
      fetchBulk: fakeBulkFetcher(sample),
      now: () => 1,
    });

    const first = orch.start('full');
    // Second call while in-flight should resolve immediately without throwing.
    await expect(orch.start('full')).resolves.toBeUndefined();
    release();
    await first;
    expect(orch.status().phase).toBe('done');
  });
});
