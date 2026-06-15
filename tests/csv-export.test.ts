import { describe, it, expect } from 'vitest';
import {
  toMoxfieldCsv,
  toDeckboxCsv,
  toManaBoxCsv,
  toMimirNativeCsv,
  parseMimirNativeCsv,
} from '../src/main/csv-export.js';
import type { ExportCard } from '../src/main/csv-export.js';

const cardNormal: ExportCard = {
  id: 1,
  scryfall_id: 'abc-123',
  name: 'Lightning Bolt',
  set_code: 'M10',
  set_name: 'Magic 2010',
  collector_number: '146',
  collection_id: 1,
  collection_name: 'Inbox',
  foil: 'normal',
  condition: 'NM',
  language: 'EN',
  quantity: 2,
  price_usd: 1.5,
  notes: null,
  needs_review: false,
  review_reasons: null,
  last_seen_at: 1_700_000_000_000,
  first_seen_at: 1_699_000_000_000,
};

const cardFoil: ExportCard = {
  id: 2,
  scryfall_id: 'def-456',
  name: 'Counterspell',
  set_code: 'TMP',
  set_name: 'Tempest',
  collector_number: '55',
  collection_id: 2,
  collection_name: 'Vintage',
  foil: 'foil',
  condition: 'LP',
  language: 'DE',
  quantity: 1,
  price_usd: 99999.99,
  notes: 'Signed copy',
  needs_review: true,
  review_reasons: 'ambiguous_identity',
  last_seen_at: 1_700_000_001_000,
  first_seen_at: 1_699_000_001_000,
};

const cardEtched: ExportCard = {
  ...cardNormal,
  id: 3,
  foil: 'etched',
  condition: 'MP',
  language: 'JA',
};

const cardComma: ExportCard = {
  ...cardNormal,
  id: 4,
  name: 'Abandon, Hope',
  set_name: 'Tempest',
  set_code: 'TMP',
  price_usd: null,
};

const cardHP: ExportCard = { ...cardNormal, id: 5, condition: 'HP' };
const cardDMG: ExportCard = { ...cardNormal, id: 6, condition: 'DMG' };
const cardNullPrice: ExportCard = { ...cardNormal, id: 7, price_usd: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function rows(csv: string): string[][] {
  return csv.split('\n').map((line) => line.split(','));
}

// ── Moxfield ──────────────────────────────────────────────────────────────────

describe('toMoxfieldCsv', () => {
  it('produces the correct header', () => {
    const csv = toMoxfieldCsv([]);
    expect(csv).toBe('Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number');
  });

  it('writes quantity in Count column', () => {
    const csv = toMoxfieldCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[0]).toBe('2');
  });

  it('uses set_name as Edition', () => {
    const csv = toMoxfieldCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[3]).toBe('Magic 2010');
  });

  it('maps NM condition correctly', () => {
    const csv = toMoxfieldCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[4]).toBe('Near Mint');
  });

  it('maps LP condition correctly', () => {
    const csv = toMoxfieldCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[4]).toBe('Lightly Played');
  });

  it('maps MP condition correctly', () => {
    const csv = toMoxfieldCsv([cardEtched]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[4]).toBe('Moderately Played');
  });

  it('maps HP condition correctly', () => {
    const csv = toMoxfieldCsv([cardHP]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[4]).toBe('Heavily Played');
  });

  it('maps DMG condition correctly', () => {
    const csv = toMoxfieldCsv([cardDMG]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[4]).toBe('Damaged');
  });

  it('sets Foil to empty string for normal cards', () => {
    const csv = toMoxfieldCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[6]).toBe('');
  });

  it('sets Foil to "foil" for foil cards', () => {
    const csv = toMoxfieldCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[6]).toBe('foil');
  });

  it('sets Foil to "foil" for etched cards (Moxfield has no etched concept)', () => {
    const csv = toMoxfieldCsv([cardEtched]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[6]).toBe('foil');
  });

  it('quotes a card name containing a comma', () => {
    const csv = toMoxfieldCsv([cardComma]);
    expect(csv).toContain('"Abandon, Hope"');
  });

  it('writes collector number in last column', () => {
    const csv = toMoxfieldCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    const cols = dataRow!.split(',');
    expect(cols[cols.length - 1]).toBe('146');
  });

  it('produces one data row per card', () => {
    const csv = toMoxfieldCsv([cardNormal, cardFoil]);
    expect(csv.split('\n')).toHaveLength(3); // header + 2 rows
  });
});

// ── Deckbox ───────────────────────────────────────────────────────────────────

describe('toDeckboxCsv', () => {
  it('produces the correct header', () => {
    const csv = toDeckboxCsv([]);
    expect(csv).toBe("Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Textless,Signed,Collector's Edition,Alter,Proxy");
  });

  it('maps NM condition correctly', () => {
    const csv = toDeckboxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[5]).toBe('Near Mint');
  });

  it('maps LP condition correctly', () => {
    const csv = toDeckboxCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[5]).toBe('Good (Lightly Played)');
  });

  it('maps MP condition correctly', () => {
    const csv = toDeckboxCsv([cardEtched]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[5]).toBe('Played');
  });

  it('maps HP condition correctly', () => {
    const csv = toDeckboxCsv([cardHP]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[5]).toBe('Heavily Played');
  });

  it('maps DMG condition correctly', () => {
    const csv = toDeckboxCsv([cardDMG]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[5]).toBe('Poor');
  });

  it('maps EN language to English', () => {
    const csv = toDeckboxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[6]).toBe('English');
  });

  it('maps DE language to German', () => {
    const csv = toDeckboxCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[6]).toBe('German');
  });

  it('maps JA language to Japanese', () => {
    const csv = toDeckboxCsv([cardEtched]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[6]).toBe('Japanese');
  });

  it('sets Foil to empty for normal cards', () => {
    const csv = toDeckboxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[7]).toBe('');
  });

  it('sets Foil to "foil" for foil cards', () => {
    const csv = toDeckboxCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[7]).toBe('foil');
  });

  it('sets Foil to "foil" for etched cards', () => {
    const csv = toDeckboxCsv([cardEtched]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[7]).toBe('foil');
  });

  it('quotes a card name containing a comma', () => {
    const csv = toDeckboxCsv([cardComma]);
    expect(csv).toContain('"Abandon, Hope"');
  });

  it('uses set_name as Edition', () => {
    const csv = toDeckboxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[3]).toBe('Magic 2010');
  });

  it('includes card number at column index 4', () => {
    const csv = toDeckboxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[4]).toBe('146');
  });
});

// ── ManaBox ───────────────────────────────────────────────────────────────────

describe('toManaBoxCsv', () => {
  it('produces the correct header', () => {
    const csv = toManaBoxCsv([]);
    expect(csv).toBe('Name,Set code,Collector number,Foil,Condition,Language,Quantity,Purchase price');
  });

  it('passes foil through as-is for normal', () => {
    const csv = toManaBoxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[3]).toBe('normal');
  });

  it('passes foil through as-is for foil', () => {
    const csv = toManaBoxCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[3]).toBe('foil');
  });

  it('passes foil through as-is for etched', () => {
    const csv = toManaBoxCsv([cardEtched]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[3]).toBe('etched');
  });

  it('passes condition through as-is', () => {
    const csv = toManaBoxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[4]).toBe('NM');
  });

  it('formats price_usd to 2 decimal places', () => {
    const csv = toManaBoxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[7]).toBe('1.50');
  });

  it('outputs empty string for null price', () => {
    const csv = toManaBoxCsv([cardNullPrice]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[7]).toBe('');
  });

  it('uses lowercase set_code', () => {
    const csv = toManaBoxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[1]).toBe('m10');
  });

  it('writes quantity at column index 6', () => {
    const csv = toManaBoxCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    expect(dataRow!.split(',')[6]).toBe('2');
  });

  it('quotes a card name containing a comma', () => {
    const csv = toManaBoxCsv([cardComma]);
    expect(csv).toContain('"Abandon, Hope"');
  });
});

// ── Mimir-native ──────────────────────────────────────────────────────────────

describe('toMimirNativeCsv', () => {
  it('produces the correct header', () => {
    const csv = toMimirNativeCsv([]);
    expect(csv).toBe('id,scryfall_id,name,set_code,set_name,collector_number,collection_id,collection_name,foil,condition,language,quantity,price_usd,notes,needs_review,review_reasons,first_seen_at,last_seen_at');
  });

  it('writes needs_review as "1" when true', () => {
    const csv = toMimirNativeCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    const cols = dataRow!.split(',');
    // needs_review is at index 14
    expect(cols[14]).toBe('1');
  });

  it('writes needs_review as "0" when false', () => {
    const csv = toMimirNativeCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    const cols = dataRow!.split(',');
    expect(cols[14]).toBe('0');
  });

  it('writes empty string for null fields', () => {
    const csv = toMimirNativeCsv([cardNormal]);
    const [, dataRow] = csv.split('\n');
    const cols = dataRow!.split(',');
    // notes at index 13
    expect(cols[13]).toBe('');
    // review_reasons at index 15
    expect(cols[15]).toBe('');
    // price_usd is 1.5 so index 12 should be "1.50"
    expect(cols[12]).toBe('1.50');
  });

  it('writes null price as empty string', () => {
    const csv = toMimirNativeCsv([cardNullPrice]);
    const [, dataRow] = csv.split('\n');
    const cols = dataRow!.split(',');
    expect(cols[12]).toBe('');
  });

  it('preserves collection_name', () => {
    const csv = toMimirNativeCsv([cardFoil]);
    const [, dataRow] = csv.split('\n');
    const cols = dataRow!.split(',');
    // collection_name at index 7
    expect(cols[7]).toBe('Vintage');
  });

  it('quotes a card name containing a comma', () => {
    const csv = toMimirNativeCsv([cardComma]);
    expect(csv).toContain('"Abandon, Hope"');
  });
});

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('parseMimirNativeCsv round-trip', () => {
  it('reconstructs a card with no special characters', () => {
    const original = [cardNormal];
    const csv = toMimirNativeCsv(original);
    const parsed = parseMimirNativeCsv(csv);
    expect(parsed).toHaveLength(1);
    const c = parsed[0]!;
    expect(c.id).toBe(cardNormal.id);
    expect(c.name).toBe(cardNormal.name);
    expect(c.set_name).toBe(cardNormal.set_name);
    expect(c.foil).toBe(cardNormal.foil);
    expect(c.condition).toBe(cardNormal.condition);
    expect(c.quantity).toBe(cardNormal.quantity);
    expect(c.price_usd).toBe(cardNormal.price_usd);
    expect(c.needs_review).toBe(cardNormal.needs_review);
    expect(c.notes).toBe(cardNormal.notes);
    expect(c.collection_name).toBe(cardNormal.collection_name);
  });

  it('reconstructs a card with a comma in the name', () => {
    const csv = toMimirNativeCsv([cardComma]);
    const parsed = parseMimirNativeCsv(csv);
    expect(parsed[0]!.name).toBe('Abandon, Hope');
  });

  it('reconstructs needs_review as boolean', () => {
    const csv = toMimirNativeCsv([cardFoil]);
    const parsed = parseMimirNativeCsv(csv);
    expect(parsed[0]!.needs_review).toBe(true);
  });

  it('reconstructs null price_usd as null', () => {
    const csv = toMimirNativeCsv([cardComma]);
    const parsed = parseMimirNativeCsv(csv);
    expect(parsed[0]!.price_usd).toBeNull();
  });

  it('reconstructs null notes as null', () => {
    const csv = toMimirNativeCsv([cardNormal]);
    const parsed = parseMimirNativeCsv(csv);
    expect(parsed[0]!.notes).toBeNull();
  });

  it('handles multiple cards', () => {
    const original = [cardNormal, cardFoil, cardComma];
    const parsed = parseMimirNativeCsv(toMimirNativeCsv(original));
    expect(parsed).toHaveLength(3);
    expect(parsed[1]!.name).toBe('Counterspell');
    expect(parsed[2]!.name).toBe('Abandon, Hope');
  });
});
