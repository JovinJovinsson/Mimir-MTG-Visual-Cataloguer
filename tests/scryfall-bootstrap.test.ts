import { describe, it, expect } from 'vitest';
import {
  planScryfallBootstrap,
  planBulkIngest,
  type IndexState,
  type ScryfallBulkCard,
} from '../src/main/scryfall-bootstrap.js';

const emptyState: IndexState = {
  hasIndex: false,
  cardCount: 0,
  setCount: 0,
  bulkDataLastFetchedAt: null,
};

describe('planScryfallBootstrap', () => {
  it('plans a full-library bulk fetch when no index exists yet', () => {
    const plan = planScryfallBootstrap('full', emptyState);
    expect(plan).toEqual({ kind: 'fetch-bulk', bulkType: 'default_cards', allowedSets: null });
  });

  it('plans a fetch even when the DB file exists but no cards are present', () => {
    const plan = planScryfallBootstrap('full', {
      hasIndex: true,
      cardCount: 0,
      setCount: 0,
      bulkDataLastFetchedAt: null,
    });
    expect(plan.kind).toBe('fetch-bulk');
  });

  it('skips bootstrap when the index is already populated', () => {
    const plan = planScryfallBootstrap('full', {
      hasIndex: true,
      cardCount: 90_000,
      setCount: 700,
      bulkDataLastFetchedAt: 1_700_000_000,
    });
    expect(plan.kind).toBe('skip');
  });

  it('selected selection returns fetch-bulk with set filter (slice 017)', () => {
    const plan = planScryfallBootstrap({ kind: 'selected', setCodes: ['dmu'] }, emptyState);
    expect(plan.kind).toBe('fetch-bulk');
    if (plan.kind === 'fetch-bulk') {
      expect(plan.allowedSets).toEqual(['dmu']);
    }
  });
});

const bulkSample: ScryfallBulkCard[] = [
  {
    id: 'sf-1',
    oracle_id: 'oracle-1',
    name: 'Lightning Bolt',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    released_at: '1993-08-05',
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    mana_cost: '{R}',
    cmc: 1,
    colors: ['R'],
    color_identity: ['R'],
    rarity: 'common',
    lang: 'en',
    image_uris: {
      art_crop: 'https://img/art_crop.jpg',
      normal: 'https://img/normal.jpg',
      small: 'https://img/small.jpg',
    },
    prices: { usd: '5.00', usd_foil: null, usd_etched: null },
    finishes: ['nonfoil'],
    layout: 'normal',
    digital: false,
  },
  {
    id: 'sf-2',
    name: 'Black Lotus',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '232',
    prices: { usd: '50000.00' },
    digital: false,
  },
  {
    id: 'sf-3',
    name: 'Digital Only Card',
    set: 'mtgo',
    set_name: 'MTGO Promos',
    collector_number: '1',
    digital: true,
  },
];

describe('planBulkIngest', () => {
  it('normalises Scryfall bulk cards to index inserts and skips digital-only cards', () => {
    const batches = planBulkIngest(bulkSample);
    const cards = batches.flatMap((b) => b.cards);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.scryfall_id).toBe('sf-1');
    expect(cards[0]?.name).toBe('Lightning Bolt');
    expect(cards[0]?.set_code).toBe('lea');
    expect(cards[0]?.collector_number).toBe('161');
    expect(cards[0]?.price_usd).toBe(5);
    expect(cards[0]?.image_art_crop_url).toBe('https://img/art_crop.jpg');
    expect(cards.find((c) => c.scryfall_id === 'sf-3')).toBeUndefined();
  });

  it('leaves phash and art_crop_path NULL (filled in by slice 003)', () => {
    const [batch] = planBulkIngest(bulkSample);
    const card = batch?.cards[0];
    expect(card?.phash).toBeNull();
    expect(card?.art_crop_path).toBeNull();
  });

  it('serialises colors and color_identity to JSON strings', () => {
    const [batch] = planBulkIngest(bulkSample);
    const card = batch?.cards.find((c) => c.scryfall_id === 'sf-1');
    expect(card?.colors_json).toBe('["R"]');
    expect(card?.color_identity_json).toBe('["R"]');
  });

  it('collapses repeated set rows: each set appears once across all batches', () => {
    const dupes: ScryfallBulkCard[] = [
      { id: 'a', name: 'A', set: 'lea', set_name: 'Alpha', collector_number: '1' },
      { id: 'b', name: 'B', set: 'lea', set_name: 'Alpha', collector_number: '2' },
      { id: 'c', name: 'C', set: 'leb', set_name: 'Beta', collector_number: '1' },
    ];
    const batches = planBulkIngest(dupes);
    const allSets = batches.flatMap((b) => b.sets);
    expect(allSets).toHaveLength(2);
    expect(allSets.map((s) => s.code).sort()).toEqual(['lea', 'leb']);
  });

  it('chunks large payloads into batches honouring the batchSize option', () => {
    const many: ScryfallBulkCard[] = Array.from({ length: 25 }, (_, i) => ({
      id: `id-${i}`,
      name: `Card ${i}`,
      set: 'tst',
      set_name: 'Test Set',
      collector_number: String(i),
    }));
    const batches = planBulkIngest(many, { batchSize: 10 });
    expect(batches).toHaveLength(3);
    expect(batches[0]?.cards).toHaveLength(10);
    expect(batches[1]?.cards).toHaveLength(10);
    expect(batches[2]?.cards).toHaveLength(5);
    expect(batches[0]?.sets).toHaveLength(1);
    expect(batches[1]?.sets).toHaveLength(0);
    expect(batches[2]?.sets).toHaveLength(0);
  });

  it('returns a single empty batch when the payload is empty', () => {
    const batches = planBulkIngest([]);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.cards).toHaveLength(0);
    expect(batches[0]?.sets).toHaveLength(0);
  });

  it('tolerates missing optional fields (no prices, no image_uris)', () => {
    const minimal: ScryfallBulkCard[] = [
      { id: 'm', name: 'Min', set: 'x', set_name: 'X', collector_number: '1' },
    ];
    const [batch] = planBulkIngest(minimal);
    const card = batch?.cards[0];
    expect(card?.price_usd).toBeNull();
    expect(card?.image_art_crop_url).toBeNull();
    expect(card?.colors_json).toBeNull();
    expect(card?.finishes_json).toBe('["nonfoil"]');
    expect(card?.lang).toBe('en');
  });
});
