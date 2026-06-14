import { parentPort, workerData } from 'node:worker_threads';
import { get as httpsGet } from 'node:https';
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

// Scan the full Buffer at byte level. ASCII structure bytes ({, }, ", \) are
// always < 0x80 in UTF-8, so multi-byte code points can never collide with
// them — byte-level scanning is safe and avoids any string-length limit.
function parseCards(buf: Buffer): void {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let arrStarted = false;
  let objStart = -1;
  let batch: ScryfallBulkCard[] = [];

  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (esc) { esc = false; continue; }
    if (b === 0x5c && inStr) { esc = true; continue; }           // '\'
    if (b === 0x22) { inStr = !inStr; continue; }                  // '"'
    if (inStr) continue;
    if (!arrStarted) { if (b === 0x5b) arrStarted = true; continue; } // '['
    if (b === 0x7b) { if (depth === 0) objStart = i; depth++; }       // '{'
    else if (b === 0x7d && depth > 0) {                                // '}'
      depth--;
      if (depth === 0 && objStart >= 0) {
        batch.push(JSON.parse(buf.toString('utf8', objStart, i + 1)) as ScryfallBulkCard);
        objStart = -1;
        if (batch.length >= BATCH_SIZE) {
          parentPort!.postMessage({ type: 'cards', cards: batch });
          batch = [];
        }
      }
    }
  }

  if (batch.length > 0) parentPort!.postMessage({ type: 'cards', cards: batch });
}

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
  const chunks: Buffer[] = [];

  res.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    downloaded += chunk.length;
    if (downloaded - lastProgressAt >= PROGRESS_INTERVAL_BYTES) {
      lastProgressAt = downloaded;
      parentPort!.postMessage({ type: 'progress', downloaded, total });
    }
  });

  res.on('error', (err: Error) => {
    parentPort!.postMessage({ type: 'error', message: err.message });
  });

  res.on('end', () => {
    parentPort!.postMessage({ type: 'progress', downloaded, total: downloaded });
    try {
      parseCards(Buffer.concat(chunks));
      parentPort!.postMessage({ type: 'done' });
    } catch (err) {
      parentPort!.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

req.on('error', (err: Error) => {
  parentPort!.postMessage({ type: 'error', message: err.message });
});
