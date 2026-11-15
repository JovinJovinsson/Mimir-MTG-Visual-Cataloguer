import { parentPort, workerData } from 'node:worker_threads';
import { get as httpsGet } from 'node:https';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import type { ScryfallBulkCard } from './scryfall-bootstrap.js';

const SCRYFALL_USER_AGENT =
  'Mimir/0.1 (https://github.com/JovinJovinsson/mimir; local catalogue)';
const BATCH_SIZE = 10_000;
const PROGRESS_INTERVAL_BYTES = 1024 * 1024; // 1 MB

function politeHeaders(): Record<string, string> {
  return { 'User-Agent': SCRYFALL_USER_AGENT, Accept: 'application/json' };
}

const { downloadUri } = workerData as { downloadUri: string };

let lastProgressAt = 0;

const req = httpsGet(downloadUri, { headers: politeHeaders() }, (res) => {
  if (res.statusCode !== 200) {
    parentPort!.postMessage({
      type: 'error',
      message: `Scryfall bulk-data download returned ${res.statusCode}`,
      status: res.statusCode ?? 0,
    });
    res.resume();
    return;
  }

  const total = res.headers['content-length'] ? Number(res.headers['content-length']) : null;
  let downloaded = 0;
  let batch: ScryfallBulkCard[] = [];
  const flush = () => {
    if (batch.length > 0) parentPort!.postMessage({ type: 'cards', cards: batch });
    batch = [];
  };
  const fail = (err: Error) => parentPort!.postMessage({ type: 'error', message: err.message });

  // Progress counts compressed bytes, matching content-length / manifest size.
  res.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded - lastProgressAt >= PROGRESS_INTERVAL_BYTES) {
      lastProgressAt = downloaded;
      parentPort!.postMessage({ type: 'progress', downloaded, total });
    }
  });

  const gunzip = createGunzip();
  res.on('error', fail);
  gunzip.on('error', fail);
  res.pipe(gunzip);

  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      batch.push(JSON.parse(line) as ScryfallBulkCard);
    } catch (err) {
      return fail(err as Error);
    }
    if (batch.length >= BATCH_SIZE) flush();
  });
  rl.on('close', () => {
    flush();
    parentPort!.postMessage({ type: 'progress', downloaded, total: downloaded });
    parentPort!.postMessage({ type: 'done' });
  });
});

req.on('error', (err: Error) => {
  parentPort!.postMessage({ type: 'error', message: err.message });
});
