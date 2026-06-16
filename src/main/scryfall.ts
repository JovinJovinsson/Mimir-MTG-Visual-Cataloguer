import type { Foil } from '../shared/types.js';

export interface ScryfallCard {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  price_usd: number | null;
  available_finishes: Foil[];
}

const USER_AGENT = 'Mimir/0.1 (https://github.com/JovinJovinsson/mimir; local catalogue)';
const ACCEPT = 'application/json';

interface ScryfallApiCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  finishes?: string[];
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
  };
}

export class ScryfallError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ScryfallError';
  }
}

function normaliseFinishes(raw: string[] | undefined): Foil[] {
  if (!raw) return ['normal'];
  const out: Foil[] = [];
  for (const f of raw) {
    if (f === 'nonfoil') out.push('normal');
    else if (f === 'foil') out.push('foil');
    else if (f === 'etched') out.push('etched');
  }
  return out.length ? out : ['normal'];
}

function parsePrice(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function fetchStandardSetCodes(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const setCodes = new Set<string>();
  let url: string | null =
    'https://api.scryfall.com/cards/search?q=is%3Astandard&unique=art&format=json';

  while (url) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT } });
    if (!res.ok) {
      throw new ScryfallError(`Standard sets fetch returned ${res.status}`, res.status);
    }
    const data = (await res.json()) as {
      data: Array<{ set: string }>;
      has_more: boolean;
      next_page?: string;
    };
    for (const card of data.data) setCodes.add(card.set);
    url = data.has_more ? (data.next_page ?? null) : null;
  }

  return Array.from(setCodes);
}

export async function fetchScryfallCardById(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScryfallCard> {
  const trimmed = id.trim();
  if (!trimmed) throw new ScryfallError('Scryfall ID is empty');

  const url = `https://api.scryfall.com/cards/${encodeURIComponent(trimmed)}`;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
  });
  if (!res.ok) {
    throw new ScryfallError(
      `Scryfall returned ${res.status} for id ${trimmed}`,
      res.status,
    );
  }
  const data = (await res.json()) as ScryfallApiCard;
  const finishes = normaliseFinishes(data.finishes);
  const priceUsd =
    parsePrice(data.prices?.usd) ??
    parsePrice(data.prices?.usd_foil) ??
    parsePrice(data.prices?.usd_etched);

  return {
    scryfall_id: data.id,
    name: data.name,
    set_code: data.set,
    set_name: data.set_name,
    collector_number: data.collector_number,
    price_usd: priceUsd,
    available_finishes: finishes,
  };
}
