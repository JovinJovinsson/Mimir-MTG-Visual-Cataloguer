import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openScryfallIndexDb,
  defaultScryfallIndexPath,
  type ScryfallIndexDb,
} from '../src/main/scryfall-index.js';
import { planBulkIngest, type ScryfallBulkCard } from '../src/main/scryfall-bootstrap.js';
import { ArtCropOrchestrator } from '../src/main/art-crop-orchestrator.js';

let tmpDir: string;
let index: ScryfallIndexDb;
let cropsDir: string;

const cards: ScryfallBulkCard[] = [
  {
    id: 'a',
    name: 'Alpha',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '1',
    image_uris: { art_crop: 'https://img/a.jpg', normal: 'n', small: 's' },
  },
  {
    id: 'b',
    name: 'Beta',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '2',
    image_uris: { art_crop: 'https://img/b.jpg', normal: 'n', small: 's' },
  },
];

const cardsWithMissing: ScryfallBulkCard[] = [
  ...cards,
  {
    id: 'c',
    name: 'No Crop',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '3',
  },
];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mimir-crops-'));
  index = openScryfallIndexDb(defaultScryfallIndexPath(tmpDir));
  cropsDir = join(tmpDir, 'art_crops');
});

afterEach(() => {
  index.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function fakeBuffer(payload: string): Buffer {
  return Buffer.from(payload, 'utf8');
}

function makeDeps(opts: {
  fetchImage?: (url: string) => Promise<Buffer>;
  decodeImage?: (buf: Buffer) => { rgba: Uint8Array; width: number; height: number };
} = {}) {
  return {
    index,
    cropsDir,
    fetchImage: opts.fetchImage ?? (async (url: string) => fakeBuffer(url)),
    decodeImage:
      opts.decodeImage ??
      ((buf: Buffer) => {
        const rgba = new Uint8Array(64 * 64 * 4);
        for (let i = 0; i < rgba.length; i++) {
          rgba[i] = (buf[i % buf.length] ?? 0) % 256;
        }
        return { rgba, width: 64, height: 64 };
      }),
  };
}

describe('ArtCropOrchestrator', () => {
  it('downloads all art crops in a set, writes pHash + path, marks set complete', async () => {
    index.ingestBatches(planBulkIngest(cards));
    const orch = new ArtCropOrchestrator(makeDeps());

    await orch.startSetDownload('lea');

    const sets = index.listSetsWithStatus();
    const lea = sets.find((s) => s.code === 'lea');
    expect(lea?.download_status).toBe('complete');
    expect(lea?.is_downloaded).toBe(1);
    expect(lea?.hashed_count).toBe(2);

    const cropRows = index.listSetCropRows('lea');
    for (const row of cropRows) {
      expect(row.phash).toMatch(/^[0-9a-f]{16}$/);
      expect(row.art_crop_path).toMatch(/lea/);
      expect(existsSync(row.art_crop_path!)).toBe(true);
    }
  });

  it('emits progress events for each downloaded card', async () => {
    index.ingestBatches(planBulkIngest(cards));
    const events: { downloaded: number; total: number; status: string }[] = [];
    const orch = new ArtCropOrchestrator(makeDeps());
    orch.on('progress', (e) => events.push({ downloaded: e.downloaded, total: e.total, status: e.status }));

    await orch.startSetDownload('lea');

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)?.status).toBe('complete');
    expect(events.at(-1)?.downloaded).toBe(2);
  });

  it('does NOT mark is_downloaded when any card still lacks a phash', async () => {
    index.ingestBatches(planBulkIngest(cardsWithMissing));
    let calls = 0;
    const deps = makeDeps({
      fetchImage: async (url: string) => {
        calls++;
        if (calls === 2) {
          const err: Error & { status?: number } = new Error('boom');
          err.status = 500;
          throw err;
        }
        return fakeBuffer(url);
      },
    });
    const orch = new ArtCropOrchestrator(deps);

    await orch.startSetDownload('lea');

    const sets = index.listSetsWithStatus();
    const lea = sets.find((s) => s.code === 'lea');
    // 'c' has no art_crop URL → skipped; one of 'a'/'b' failed → set not complete
    expect(lea?.is_downloaded).toBe(0);
    expect(lea?.download_status).toBe('error');
  });

  it('clears phash/art_crop_path and deletes the set crop directory on remove', async () => {
    index.ingestBatches(planBulkIngest(cards));
    const orch = new ArtCropOrchestrator(makeDeps());
    await orch.startSetDownload('lea');

    const dirBefore = join(cropsDir, 'lea');
    expect(existsSync(dirBefore)).toBe(true);
    expect(readdirSync(dirBefore).length).toBe(2);

    await orch.removeSetCrops('lea');

    expect(existsSync(dirBefore)).toBe(false);
    const rows = index.listSetCropRows('lea');
    for (const r of rows) {
      expect(r.phash).toBeNull();
      expect(r.art_crop_path).toBeNull();
    }
    const sets = index.listSetsWithStatus();
    expect(sets.find((s) => s.code === 'lea')?.download_status).toBe('none');
    expect(sets.find((s) => s.code === 'lea')?.is_downloaded).toBe(0);
  });

  it('honours rate limit between fetches', async () => {
    index.ingestBatches(planBulkIngest(cards));
    const callTimes: number[] = [];
    let now = 1000;
    const deps = {
      ...makeDeps({
        fetchImage: async (url: string) => {
          callTimes.push(now);
          now += 10; // fetch itself "takes" 10ms
          return fakeBuffer(url);
        },
      }),
      rateLimit: async () => {
        now += 50; // simulated rate-limit wait
      },
    };
    const orch = new ArtCropOrchestrator(deps);
    await orch.startSetDownload('lea');

    expect(callTimes.length).toBe(2);
    // Second call must be at least the rate-limit interval later.
    expect((callTimes[1] ?? 0) - (callTimes[0] ?? 0)).toBeGreaterThanOrEqual(50);
  });

  it('retries on HTTP 429', async () => {
    index.ingestBatches(planBulkIngest([cards[0]!]));
    let attempts = 0;
    const deps = {
      ...makeDeps({
        fetchImage: async (url: string) => {
          attempts++;
          if (attempts === 1) {
            const err: Error & { status?: number; retryAfterMs?: number } = new Error('429');
            err.status = 429;
            err.retryAfterMs = 1;
            throw err;
          }
          return fakeBuffer(url);
        },
      }),
    };
    const orch = new ArtCropOrchestrator(deps);
    await orch.startSetDownload('lea');

    expect(attempts).toBe(2);
    const sets = index.listSetsWithStatus();
    expect(sets.find((s) => s.code === 'lea')?.download_status).toBe('complete');
  });

  it('skips a set that has no downloadable cards (no art-crop URLs at all)', async () => {
    const noUrl: ScryfallBulkCard[] = [
      { id: 'x', name: 'X', set: 'tst', set_name: 'Test', collector_number: '1' },
    ];
    index.ingestBatches(planBulkIngest(noUrl));
    const orch = new ArtCropOrchestrator(makeDeps());
    await orch.startSetDownload('tst');
    const sets = index.listSetsWithStatus();
    const tst = sets.find((s) => s.code === 'tst');
    expect(tst?.download_status).toBe('complete');
  });
});
