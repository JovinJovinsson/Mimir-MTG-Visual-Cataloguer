import { get as httpsGet } from 'node:https';
import type { ScryfallBulkCard } from './scryfall-bootstrap.js';

export const SCRYFALL_USER_AGENT =
  'Mimir/0.1 (https://github.com/JovinJovinsson/mimir; local catalogue)';
const ACCEPT = 'application/json';

const BULK_DATA_BASE = 'https://api.scryfall.com/bulk-data';

export interface BulkDataManifest {
  type: string;
  download_uri: string;
  updated_at: string;
  size: number;
}

export interface HttpError extends Error {
  status: number;
  retryAfterMs?: number;
}

function httpError(message: string, status: number, retryAfterMs?: number): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
  return err;
}

function politeHeaders(): Record<string, string> {
  return { 'User-Agent': SCRYFALL_USER_AGENT, Accept: ACCEPT };
}

export async function fetchBulkDataManifest(
  bulkType: 'default_cards' | 'oracle_cards' | 'all_cards',
  fetchImpl: typeof fetch = fetch,
): Promise<BulkDataManifest> {
  const slug = bulkType.replace(/_/g, '-');
  const res = await fetchImpl(`${BULK_DATA_BASE}/${slug}`, { headers: politeHeaders() });
  if (!res.ok) {
    throw httpError(
      `Scryfall bulk-data manifest ${slug} returned ${res.status}`,
      res.status,
      parseRetryAfter(res),
    );
  }
  const data = (await res.json()) as BulkDataManifest;
  if (!data.download_uri) {
    throw new Error('Scryfall bulk-data manifest missing download_uri');
  }
  return data;
}

export async function fetchBulkData(
  downloadUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScryfallBulkCard[]> {
  const res = await fetchImpl(downloadUri, { headers: politeHeaders() });
  if (!res.ok) {
    throw httpError(
      `Scryfall bulk-data download returned ${res.status}`,
      res.status,
      parseRetryAfter(res),
    );
  }
  const data = (await res.json()) as ScryfallBulkCard[];
  if (!Array.isArray(data)) {
    throw new Error('Scryfall bulk-data payload was not an array');
  }
  return data;
}

export type DownloadProgressFn = (downloadedBytes: number, totalBytes: number | null) => void;

// Uses Node.js native https to bypass Electron's net.fetch body-size limits (~256 MB cap)
// for the 500 MB+ Scryfall bulk JSON download.
export function downloadBulkJson(
  downloadUri: string,
  onProgress?: DownloadProgressFn,
): Promise<ScryfallBulkCard[]> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(downloadUri, { headers: politeHeaders() }, (res) => {
      if (res.statusCode !== 200) {
        reject(httpError(
          `Scryfall bulk-data download returned ${res.statusCode}`,
          res.statusCode ?? 0,
          parseRetryAfterHeader(res.headers['retry-after']),
        ));
        res.resume();
        return;
      }

      const total = res.headers['content-length'] ? Number(res.headers['content-length']) : null;
      let downloaded = 0;
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        downloaded += chunk.length;
        onProgress?.(downloaded, total);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ScryfallBulkCard[];
          if (!Array.isArray(data)) {
            reject(new Error('Scryfall bulk-data payload was not an array'));
            return;
          }
          resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
  });
}

function parseRetryAfterHeader(header: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers?.get?.('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export class RateLimiter {
  private nextAvailableAt = 0;
  constructor(private readonly minIntervalMs: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.minIntervalMs;
    if (wait > 0) await sleep(wait);
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function retryOn429<T>(
  attempt: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleepFn = opts.sleep ?? sleep;
  const base = opts.baseDelayMs ?? 1000;
  let lastErr: unknown;
  for (let i = 0; i <= opts.maxRetries; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      const status = (err as HttpError | undefined)?.status;
      if (status !== 429) throw err;
      if (i === opts.maxRetries) throw err;
      const retryAfter = (err as HttpError).retryAfterMs;
      const backoff = retryAfter ?? base * 2 ** i;
      await sleepFn(backoff);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
