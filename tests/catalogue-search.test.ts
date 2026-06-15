import { describe, it, expect } from 'vitest';
import {
  parseSearchQuery,
  astToSqlFragment,
  filterCards,
  setSearchToken,
  toggleSearchToken,
  toggleHasReview,
} from '../src/shared/catalogue-search.js';
import type { CardForRenderer, CollectionForRenderer } from '../src/shared/types.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const baseCard: CardForRenderer = {
  id: 1,
  scryfall_id: 'sf-1',
  name: 'Lightning Bolt',
  set_code: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
  collection_id: 1,
  foil: 'normal',
  condition: 'NM',
  language: 'EN',
  quantity: 1,
  price_usd: 1.50,
  notes: null,
  first_seen_at: 1_000_000,
  last_seen_at: 1_000_000,
  needs_review: false,
  review_reasons: null,
};

const foilCard: CardForRenderer = {
  ...baseCard,
  id: 2,
  scryfall_id: 'sf-2',
  name: 'Sol Ring',
  set_code: 'lea',
  set_name: 'Alpha',
  foil: 'foil',
  condition: 'LP',
  collection_id: 2,
  price_usd: 20.00,
  needs_review: true,
};

const etchedCard: CardForRenderer = {
  ...baseCard,
  id: 3,
  scryfall_id: 'sf-3',
  name: 'Black Lotus',
  set_code: 'lea',
  foil: 'etched',
  condition: 'HP',
  collection_id: 1,
  price_usd: 5000.00,
  needs_review: false,
};

const allCards = [baseCard, foilCard, etchedCard];

const collections: CollectionForRenderer[] = [
  { id: 1, name: 'Inbox', is_wishlist: false, sort_order: 0, count: 2 },
  { id: 2, name: 'Wishlist', is_wishlist: true, sort_order: 1, count: 1 },
];

// ── parseSearchQuery ───────────────────────────────────────────────────────────

describe('parseSearchQuery', () => {
  it('empty string returns empty AST', () => {
    const ast = parseSearchQuery('');
    expect(ast.tokens).toHaveLength(0);
    expect(ast.error).toBeNull();
  });

  it('plain text becomes name substring token', () => {
    const ast = parseSearchQuery('bolt');
    expect(ast.tokens).toHaveLength(1);
    expect(ast.tokens[0]).toEqual({ kind: 'name', value: 'bolt', negated: false });
  });

  it('name: operator', () => {
    const ast = parseSearchQuery('name:bolt');
    expect(ast.tokens[0]).toEqual({ kind: 'name', value: 'bolt', negated: false });
  });

  it('quoted multi-word value', () => {
    const ast = parseSearchQuery('name:"Sol Ring"');
    expect(ast.tokens[0]).toEqual({ kind: 'name', value: 'Sol Ring', negated: false });
  });

  it('negated set operator', () => {
    const ast = parseSearchQuery('-set:m10');
    expect(ast.tokens[0]).toEqual({ kind: 'set', value: 'm10', negated: true });
  });

  it('foil: operator normalises to lowercase', () => {
    const ast = parseSearchQuery('foil:Foil');
    expect(ast.tokens[0]).toEqual({ kind: 'foil', value: 'foil', negated: false });
  });

  it('is:foil maps to foil:foil', () => {
    const ast = parseSearchQuery('is:foil');
    expect(ast.tokens[0]).toEqual({ kind: 'foil', value: 'foil', negated: false });
  });

  it('-is:foil maps to negated foil:foil', () => {
    const ast = parseSearchQuery('-is:foil');
    expect(ast.tokens[0]).toEqual({ kind: 'foil', value: 'foil', negated: true });
  });

  it('condition: operator uppercases value', () => {
    const ast = parseSearchQuery('condition:nm');
    expect(ast.tokens[0]).toEqual({ kind: 'condition', value: 'NM', negated: false });
  });

  it('collection: operator with quoted name', () => {
    const ast = parseSearchQuery('collection:"My Collection"');
    expect(ast.tokens[0]).toEqual({ kind: 'collection', value: 'My Collection', negated: false });
  });

  it('price: with < comparator', () => {
    const ast = parseSearchQuery('price:<10');
    expect(ast.tokens[0]).toEqual({ kind: 'price', op: '<', value: 10, negated: false });
  });

  it('price: with >= comparator', () => {
    const ast = parseSearchQuery('price:>=3.50');
    expect(ast.tokens[0]).toEqual({ kind: 'price', op: '>=', value: 3.5, negated: false });
  });

  it('price: with no comparator defaults to =', () => {
    const ast = parseSearchQuery('price:5');
    expect(ast.tokens[0]).toEqual({ kind: 'price', op: '=', value: 5, negated: false });
  });

  it('cmc: with comparator', () => {
    const ast = parseSearchQuery('cmc:>=5');
    expect(ast.tokens[0]).toEqual({ kind: 'cmc', op: '>=', value: 5, negated: false });
  });

  it('has-review boolean flag', () => {
    const ast = parseSearchQuery('has-review');
    expect(ast.tokens[0]).toEqual({ kind: 'has-review', negated: false });
  });

  it('-has-review negated boolean', () => {
    const ast = parseSearchQuery('-has-review');
    expect(ast.tokens[0]).toEqual({ kind: 'has-review', negated: true });
  });

  it('type: operator parsed but does not error', () => {
    const ast = parseSearchQuery('type:instant');
    expect(ast.tokens[0]).toEqual({ kind: 'type', value: 'instant', negated: false });
    expect(ast.error).toBeNull();
  });

  it('colors: operator (alias c:) parsed', () => {
    const ast1 = parseSearchQuery('colors:W');
    const ast2 = parseSearchQuery('c:W');
    expect(ast1.tokens[0]).toEqual({ kind: 'colors', value: 'W', negated: false });
    expect(ast2.tokens[0]).toEqual({ kind: 'colors', value: 'W', negated: false });
  });

  it('unknown operator sets error and continues parsing remaining tokens', () => {
    const ast = parseSearchQuery('foo:bar name:bolt');
    expect(ast.error).toMatch(/unknown operator/i);
    expect(ast.tokens).toHaveLength(1);
    expect(ast.tokens[0]).toEqual({ kind: 'name', value: 'bolt', negated: false });
  });

  it('invalid price value sets error', () => {
    const ast = parseSearchQuery('price:abc');
    expect(ast.error).toMatch(/invalid price/i);
  });

  it('multiple tokens parsed', () => {
    const ast = parseSearchQuery('bolt set:m10 -foil:foil has-review');
    expect(ast.tokens).toHaveLength(4);
    expect(ast.tokens[0]).toEqual({ kind: 'name', value: 'bolt', negated: false });
    expect(ast.tokens[1]).toEqual({ kind: 'set', value: 'm10', negated: false });
    expect(ast.tokens[2]).toEqual({ kind: 'foil', value: 'foil', negated: true });
    expect(ast.tokens[3]).toEqual({ kind: 'has-review', negated: false });
  });
});

// ── astToSqlFragment ───────────────────────────────────────────────────────────

describe('astToSqlFragment', () => {
  it('empty AST returns 1=1', () => {
    const frag = astToSqlFragment({ tokens: [], error: null });
    expect(frag.where).toBe('1=1');
    expect(frag.params).toHaveLength(0);
  });

  it('name token → LIKE clause with % wildcards', () => {
    const ast = parseSearchQuery('bolt');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.name LIKE ? COLLATE NOCASE');
    expect(frag.params).toEqual(['%bolt%']);
  });

  it('negated name → NOT LIKE', () => {
    const ast = parseSearchQuery('-name:bolt');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.name NOT LIKE ? COLLATE NOCASE');
    expect(frag.params).toEqual(['%bolt%']);
  });

  it('set token → LOWER equality', () => {
    const ast = parseSearchQuery('set:m10');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('LOWER(c.set_code) = ?');
    expect(frag.params).toEqual(['m10']);
  });

  it('negated set → !=', () => {
    const ast = parseSearchQuery('-set:m10');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('LOWER(c.set_code) != ?');
  });

  it('foil token → c.foil equality', () => {
    const ast = parseSearchQuery('foil:foil');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.foil = ?');
    expect(frag.params).toEqual(['foil']);
  });

  it('condition token → c.condition equality', () => {
    const ast = parseSearchQuery('condition:NM');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.condition = ?');
    expect(frag.params).toEqual(['NM']);
  });

  it('collection token → col.name equality', () => {
    const ast = parseSearchQuery('collection:Inbox');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('col.name = ? COLLATE NOCASE');
    expect(frag.params).toEqual(['Inbox']);
  });

  it('price < comparator', () => {
    const ast = parseSearchQuery('price:<10');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.price_at_first_scan_usd < ?');
    expect(frag.params).toEqual([10]);
  });

  it('price >= comparator', () => {
    const ast = parseSearchQuery('price:>=3.50');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.price_at_first_scan_usd >= ?');
    expect(frag.params).toEqual([3.5]);
  });

  it('negated price < inverts to >=', () => {
    const ast = parseSearchQuery('-price:<10');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.price_at_first_scan_usd >= ?');
    expect(frag.params).toEqual([10]);
  });

  it('has-review → needs_review = 1', () => {
    const ast = parseSearchQuery('has-review');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.needs_review = 1');
  });

  it('negated has-review → needs_review = 0', () => {
    const ast = parseSearchQuery('-has-review');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.needs_review = 0');
  });

  it('type/colors/cmc tokens produce no SQL clause (unsupported v1)', () => {
    const ast = parseSearchQuery('type:instant colors:W');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('1=1');
    expect(frag.params).toHaveLength(0);
  });

  it('multiple tokens joined with AND', () => {
    const ast = parseSearchQuery('bolt set:m10');
    const frag = astToSqlFragment(ast);
    expect(frag.where).toBe('c.name LIKE ? COLLATE NOCASE AND LOWER(c.set_code) = ?');
    expect(frag.params).toEqual(['%bolt%', 'm10']);
  });
});

// ── filterCards ────────────────────────────────────────────────────────────────

describe('filterCards', () => {
  it('empty AST returns all cards', () => {
    const ast = parseSearchQuery('');
    expect(filterCards(allCards, collections, ast)).toEqual(allCards);
  });

  it('plain text filters by name substring (case-insensitive)', () => {
    const ast = parseSearchQuery('bolt');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Lightning Bolt');
  });

  it('negated name excludes matching cards', () => {
    const ast = parseSearchQuery('-name:bolt');
    const result = filterCards(allCards, collections, ast);
    expect(result.every((c) => !c.name.toLowerCase().includes('bolt'))).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('set: filters by set code (case-insensitive)', () => {
    const ast = parseSearchQuery('set:lea');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.set_code === 'lea')).toBe(true);
  });

  it('foil: filters by foil type', () => {
    const ast = parseSearchQuery('foil:foil');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(1);
    expect(result[0].foil).toBe('foil');
  });

  it('condition: filters by condition', () => {
    const ast = parseSearchQuery('condition:NM');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(1);
    expect(result[0].condition).toBe('NM');
  });

  it('collection: filters by collection name', () => {
    const ast = parseSearchQuery('collection:Wishlist');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(1);
    expect(result[0].collection_id).toBe(2);
  });

  it('collection: is case-insensitive', () => {
    const ast = parseSearchQuery('collection:inbox');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(2);
  });

  it('price:< filters cards below threshold', () => {
    const ast = parseSearchQuery('price:<10');
    const result = filterCards(allCards, collections, ast);
    expect(result.every((c) => (c.price_usd ?? Infinity) < 10)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Lightning Bolt');
  });

  it('price:>= filters cards at or above threshold', () => {
    const ast = parseSearchQuery('price:>=20');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(2);
  });

  it('null price card excluded from price filter', () => {
    const nullPriceCard: CardForRenderer = { ...baseCard, id: 99, price_usd: null };
    const ast = parseSearchQuery('price:<10');
    const result = filterCards([nullPriceCard], collections, ast);
    expect(result).toHaveLength(0);
  });

  it('has-review filters to cards needing review', () => {
    const ast = parseSearchQuery('has-review');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(1);
    expect(result[0].needs_review).toBe(true);
  });

  it('-has-review excludes cards needing review', () => {
    const ast = parseSearchQuery('-has-review');
    const result = filterCards(allCards, collections, ast);
    expect(result.every((c) => !c.needs_review)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('type/colors/cmc tokens are pass-through (unsupported v1)', () => {
    const ast = parseSearchQuery('type:instant colors:W cmc:>=5');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(allCards.length);
  });

  it('multiple tokens all must match (AND logic)', () => {
    const ast = parseSearchQuery('set:lea foil:foil');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Sol Ring');
  });

  it('-set:m10 excludes M10 cards', () => {
    const ast = parseSearchQuery('-set:m10');
    const result = filterCards(allCards, collections, ast);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.set_code !== 'm10')).toBe(true);
  });
});

// ── setSearchToken ─────────────────────────────────────────────────────────────

describe('setSearchToken', () => {
  it('adds token to empty query', () => {
    expect(setSearchToken('', 'foil', 'foil')).toBe('foil:foil');
  });

  it('appends token to existing query', () => {
    expect(setSearchToken('name:bolt', 'foil', 'foil')).toBe('name:bolt foil:foil');
  });

  it('replaces existing token of same kind', () => {
    expect(setSearchToken('foil:normal', 'foil', 'foil')).toBe('foil:foil');
  });

  it('removes token when value is null', () => {
    expect(setSearchToken('name:bolt foil:foil', 'foil', null)).toBe('name:bolt');
  });

  it('multi-word value gets quoted', () => {
    expect(setSearchToken('', 'collection', 'My Deck')).toBe('collection:"My Deck"');
  });

  it('removes negated token of same kind', () => {
    expect(setSearchToken('-foil:foil', 'foil', 'normal')).toBe('foil:normal');
  });
});

// ── toggleSearchToken ──────────────────────────────────────────────────────────

describe('toggleSearchToken', () => {
  it('adds token when not present', () => {
    expect(toggleSearchToken('', 'foil', 'foil')).toBe('foil:foil');
  });

  it('removes token when already present', () => {
    expect(toggleSearchToken('name:bolt foil:foil', 'foil', 'foil')).toBe('name:bolt');
  });

  it('is case-insensitive for value matching', () => {
    expect(toggleSearchToken('foil:FOIL', 'foil', 'foil')).toBe('');
  });

  it('replaces different value of same kind (add new)', () => {
    // foil:normal is different from foil:foil, so toggle adds foil:foil
    expect(toggleSearchToken('foil:normal', 'foil', 'foil')).toBe('foil:normal foil:foil');
  });
});

// ── toggleHasReview ────────────────────────────────────────────────────────────

describe('toggleHasReview', () => {
  it('adds has-review to empty query', () => {
    expect(toggleHasReview('')).toBe('has-review');
  });

  it('removes has-review when present', () => {
    expect(toggleHasReview('has-review')).toBe('');
  });

  it('removes has-review from middle of query', () => {
    expect(toggleHasReview('name:bolt has-review set:m10')).toBe('name:bolt set:m10');
  });

  it('adds has-review alongside other tokens', () => {
    expect(toggleHasReview('name:bolt')).toBe('name:bolt has-review');
  });
});
