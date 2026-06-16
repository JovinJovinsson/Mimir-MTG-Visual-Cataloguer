export type UserSelection =
  | 'full'
  | { kind: 'selected'; setCodes: string[] }
  | { kind: 'standard'; standardSetCodes: string[] };

export interface IndexState {
  hasIndex: boolean;
  cardCount: number;
  setCount: number;
  bulkDataLastFetchedAt: number | null;
}

export type DownloadPlan =
  | { kind: 'fetch-bulk'; bulkType: 'default_cards'; allowedSets: string[] | null }
  | { kind: 'skip'; reason: string };

export function planScryfallBootstrap(
  selection: UserSelection,
  state: IndexState,
): DownloadPlan {
  if (selection === 'full') {
    if (state.hasIndex && state.cardCount > 0) {
      return { kind: 'skip', reason: 'scryfall index already populated' };
    }
    return { kind: 'fetch-bulk', bulkType: 'default_cards', allowedSets: null };
  }

  if (selection.kind === 'selected') {
    if (state.hasIndex && state.cardCount > 0) {
      return { kind: 'skip', reason: 'scryfall index already populated' };
    }
    return { kind: 'fetch-bulk', bulkType: 'default_cards', allowedSets: selection.setCodes };
  }

  // standard
  if (state.hasIndex && state.cardCount > 0) {
    return { kind: 'skip', reason: 'scryfall index already populated' };
  }
  return { kind: 'fetch-bulk', bulkType: 'default_cards', allowedSets: selection.standardSetCodes };
}

export interface ScryfallBulkCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  oracle_id?: string;
  released_at?: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  rarity?: string;
  lang?: string;
  image_uris?: {
    art_crop?: string;
    normal?: string;
    small?: string;
  };
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
  };
  finishes?: string[];
  layout?: string;
  digital?: boolean;
}

export interface ScryfallCardInsert {
  scryfall_id: string;
  oracle_id: string | null;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  released_at: string | null;
  type_line: string | null;
  oracle_text: string | null;
  mana_cost: string | null;
  cmc: number | null;
  colors_json: string | null;
  color_identity_json: string | null;
  rarity: string | null;
  lang: string;
  image_art_crop_url: string | null;
  image_normal_url: string | null;
  image_small_url: string | null;
  price_usd: number | null;
  price_usd_foil: number | null;
  price_usd_etched: number | null;
  finishes_json: string;
  layout: string | null;
  is_digital: 0 | 1;
  phash: string | null;
  art_crop_path: string | null;
}

export interface ScryfallSetInsert {
  code: string;
  name: string;
}

export interface InsertBatch {
  sets: ScryfallSetInsert[];
  cards: ScryfallCardInsert[];
}

export interface IngestOptions {
  batchSize?: number;
  includeDigital?: boolean;
  allowedSets?: string[] | null;
}

const DEFAULT_BATCH_SIZE = 1000;

export function planBulkIngest(
  payload: ScryfallBulkCard[],
  options: IngestOptions = {},
): InsertBatch[] {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const includeDigital = options.includeDigital ?? false;
  const allowedSets = options.allowedSets ? new Set(options.allowedSets) : null;

  const cards: ScryfallCardInsert[] = [];
  const setMap = new Map<string, ScryfallSetInsert>();

  for (const raw of payload) {
    if (!includeDigital && raw.digital) continue;
    if (allowedSets && !allowedSets.has(raw.set)) continue;

    cards.push(normaliseCard(raw));
    if (!setMap.has(raw.set)) {
      setMap.set(raw.set, { code: raw.set, name: raw.set_name });
    }
  }

  const sets = Array.from(setMap.values());
  if (cards.length === 0) {
    return [{ sets, cards: [] }];
  }

  const batches: InsertBatch[] = [];
  for (let i = 0; i < cards.length; i += batchSize) {
    batches.push({
      sets: i === 0 ? sets : [],
      cards: cards.slice(i, i + batchSize),
    });
  }
  return batches;
}

function normaliseCard(raw: ScryfallBulkCard): ScryfallCardInsert {
  return {
    scryfall_id: raw.id,
    oracle_id: raw.oracle_id ?? null,
    name: raw.name,
    set_code: raw.set,
    set_name: raw.set_name,
    collector_number: raw.collector_number,
    released_at: raw.released_at ?? null,
    type_line: raw.type_line ?? null,
    oracle_text: raw.oracle_text ?? null,
    mana_cost: raw.mana_cost ?? null,
    cmc: typeof raw.cmc === 'number' ? raw.cmc : null,
    colors_json: raw.colors ? JSON.stringify(raw.colors) : null,
    color_identity_json: raw.color_identity ? JSON.stringify(raw.color_identity) : null,
    rarity: raw.rarity ?? null,
    lang: raw.lang ?? 'en',
    image_art_crop_url: raw.image_uris?.art_crop ?? null,
    image_normal_url: raw.image_uris?.normal ?? null,
    image_small_url: raw.image_uris?.small ?? null,
    price_usd: parsePrice(raw.prices?.usd),
    price_usd_foil: parsePrice(raw.prices?.usd_foil),
    price_usd_etched: parsePrice(raw.prices?.usd_etched),
    finishes_json: JSON.stringify(raw.finishes ?? ['nonfoil']),
    layout: raw.layout ?? null,
    is_digital: raw.digital ? 1 : 0,
    phash: null,
    art_crop_path: null,
  };
}

function parsePrice(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
