import type { CardForRenderer, CollectionForRenderer } from './types.js';

export type Comparator = '=' | '<' | '>' | '<=' | '>=';

export type SearchToken =
  | { kind: 'name'; value: string; negated: boolean }
  | { kind: 'set'; value: string; negated: boolean }
  | { kind: 'type'; value: string; negated: boolean }
  | { kind: 'colors'; value: string; negated: boolean }
  | { kind: 'cmc'; op: Comparator; value: number; negated: boolean }
  | { kind: 'foil'; value: string; negated: boolean }
  | { kind: 'collection'; value: string; negated: boolean }
  | { kind: 'condition'; value: string; negated: boolean }
  | { kind: 'price'; op: Comparator; value: number; negated: boolean }
  | { kind: 'has-review'; negated: boolean };

export interface SearchAST {
  tokens: SearchToken[];
  error: string | null;
}

export interface SqlFragment {
  where: string;
  params: (string | number)[];
}

// ── Tokenizer ──────────────────────────────────────────────────────────────────

function tokenize(input: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && input[i] === ' ') i++;
    if (i >= input.length) break;

    let tok = '';
    if (input[i] === '-') { tok = '-'; i++; }

    while (i < input.length && input[i] !== ' ') {
      if (input[i] === '"') {
        tok += '"';
        i++;
        while (i < input.length && input[i] !== '"') tok += input[i++];
        if (i < input.length) { tok += '"'; i++; }
      } else {
        tok += input[i++];
      }
    }

    if (tok && tok !== '-') result.push(tok);
  }
  return result;
}

function unquote(s: string): string {
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1) return s.slice(1, -1);
  return s;
}

function parseNumericValue(val: string): { op: Comparator; value: number } | null {
  const m = /^(<=|>=|<|>|=)?(.+)$/.exec(val);
  if (!m || !m[2]) return null;
  const op = (m[1] as Comparator | undefined) ?? '=';
  const num = parseFloat(m[2]);
  return isNaN(num) ? null : { op, value: num };
}

function parseRawToken(raw: string): SearchToken | null {
  let negated = false;
  let s = raw;
  if (s.startsWith('-')) { negated = true; s = s.slice(1); }

  if (s.toLowerCase() === 'has-review') return { kind: 'has-review', negated };

  const colonIdx = s.indexOf(':');
  if (colonIdx > 0) {
    const op = s.slice(0, colonIdx).toLowerCase();
    const rawVal = s.slice(colonIdx + 1);
    const val = unquote(rawVal);

    switch (op) {
      case 'name': return { kind: 'name', value: val, negated };
      case 'set': return { kind: 'set', value: val, negated };
      case 'type': return { kind: 'type', value: val, negated };
      case 'colors':
      case 'c': return { kind: 'colors', value: val, negated };
      case 'is':
        if (val.toLowerCase() === 'foil') return { kind: 'foil', value: 'foil', negated };
        return null;
      case 'foil': return { kind: 'foil', value: val.toLowerCase(), negated };
      case 'collection': return { kind: 'collection', value: val, negated };
      case 'condition': return { kind: 'condition', value: val.toUpperCase(), negated };
      case 'cmc': {
        const parsed = parseNumericValue(val);
        if (!parsed) throw new Error(`Invalid cmc value: ${val}`);
        return { kind: 'cmc', ...parsed, negated };
      }
      case 'price': {
        const parsed = parseNumericValue(val);
        if (!parsed) throw new Error(`Invalid price value: ${val}`);
        return { kind: 'price', ...parsed, negated };
      }
      default:
        throw new Error(`Unknown operator: ${op}`);
    }
  }

  if (s) return { kind: 'name', value: unquote(s), negated };
  return null;
}

export function parseSearchQuery(input: string): SearchAST {
  const tokens: SearchToken[] = [];
  let error: string | null = null;
  for (const raw of tokenize(input.trim())) {
    try {
      const t = parseRawToken(raw);
      if (t) tokens.push(t);
    } catch (e) {
      if (!error) error = e instanceof Error ? e.message : String(e);
    }
  }
  return { tokens, error };
}

// ── AST → SQL fragment ─────────────────────────────────────────────────────────

function invertComparator(op: Comparator): string {
  switch (op) {
    case '=': return '!=';
    case '<': return '>=';
    case '>': return '<=';
    case '<=': return '>';
    case '>=': return '<';
  }
}

function numericSql(col: string, op: Comparator, val: number, negated: boolean, params: (string | number)[]): string {
  params.push(val);
  return `${col} ${negated ? invertComparator(op) : op} ?`;
}

function tokenToSqlClause(token: SearchToken, params: (string | number)[]): string | null {
  const neg = token.negated;
  switch (token.kind) {
    case 'name':
      params.push(`%${token.value}%`);
      return `c.name ${neg ? 'NOT ' : ''}LIKE ? COLLATE NOCASE`;
    case 'set':
      params.push(token.value.toLowerCase());
      return `LOWER(c.set_code) ${neg ? '!=' : '='} ?`;
    case 'foil':
      params.push(token.value);
      return `c.foil ${neg ? '!=' : '='} ?`;
    case 'condition':
      params.push(token.value);
      return `c.condition ${neg ? '!=' : '='} ?`;
    case 'collection':
      params.push(token.value);
      return `col.name ${neg ? '!=' : '='} ? COLLATE NOCASE`;
    case 'price':
      return numericSql('c.price_at_first_scan_usd', token.op, token.value, neg, params);
    case 'has-review':
      return `c.needs_review = ${neg ? 0 : 1}`;
    // type, colors, cmc require columns not in the cards table in v1
    case 'type':
    case 'colors':
    case 'cmc':
      return null;
    default:
      return null;
  }
}

export function astToSqlFragment(ast: SearchAST): SqlFragment {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  for (const token of ast.tokens) {
    const clause = tokenToSqlClause(token, params);
    if (clause) conditions.push(clause);
  }
  return {
    where: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
    params,
  };
}

// ── Client-side filter ─────────────────────────────────────────────────────────

function compareNum(actual: number, op: Comparator, expected: number): boolean {
  switch (op) {
    case '=': return actual === expected;
    case '<': return actual < expected;
    case '>': return actual > expected;
    case '<=': return actual <= expected;
    case '>=': return actual >= expected;
  }
}

function matchToken(card: CardForRenderer, colMap: Map<number, string>, token: SearchToken): boolean {
  const neg = token.negated;
  switch (token.kind) {
    case 'name': {
      const m = card.name.toLowerCase().includes(token.value.toLowerCase());
      return neg ? !m : m;
    }
    case 'set': {
      const m = card.set_code.toLowerCase() === token.value.toLowerCase();
      return neg ? !m : m;
    }
    case 'foil': {
      const m = card.foil === token.value;
      return neg ? !m : m;
    }
    case 'condition': {
      const m = card.condition === token.value;
      return neg ? !m : m;
    }
    case 'collection': {
      const colName = colMap.get(card.collection_id) ?? '';
      const m = colName.toLowerCase() === token.value.toLowerCase();
      return neg ? !m : m;
    }
    case 'price': {
      if (card.price_usd === null) return neg;
      const m = compareNum(card.price_usd, token.op, token.value);
      return neg ? !m : m;
    }
    case 'has-review': {
      const m = card.needs_review;
      return neg ? !m : m;
    }
    // Not supported in v1 — pass-through (don't filter)
    case 'type':
    case 'colors':
    case 'cmc':
      return true;
    default:
      return true;
  }
}

export function filterCards(
  cards: CardForRenderer[],
  collections: CollectionForRenderer[],
  ast: SearchAST,
): CardForRenderer[] {
  if (ast.tokens.length === 0) return cards;
  const colMap = new Map(collections.map((c) => [c.id, c.name]));
  return cards.filter((card) => ast.tokens.every((t) => matchToken(card, colMap, t)));
}

// ── Query mutation utilities ───────────────────────────────────────────────────

export function setSearchToken(query: string, kind: string, value: string | null): string {
  const kindLc = kind.toLowerCase();
  const parts = tokenize(query).filter((tok) => {
    const s = tok.startsWith('-') ? tok.slice(1) : tok;
    const ci = s.indexOf(':');
    if (ci <= 0) return true;
    return s.slice(0, ci).toLowerCase() !== kindLc;
  });
  if (value === null) return parts.join(' ');
  const serialized = value.includes(' ') ? `${kind}:"${value}"` : `${kind}:${value}`;
  return [...parts, serialized].join(' ').trim();
}

export function toggleSearchToken(query: string, kind: string, value: string): string {
  const kindLc = kind.toLowerCase();
  const valLc = value.toLowerCase();
  const parts = tokenize(query);
  const idx = parts.findIndex((tok) => {
    const s = tok.startsWith('-') ? tok.slice(1) : tok;
    const ci = s.indexOf(':');
    if (ci <= 0) return false;
    return (
      s.slice(0, ci).toLowerCase() === kindLc &&
      unquote(s.slice(ci + 1)).toLowerCase() === valLc
    );
  });
  if (idx >= 0) {
    return parts.filter((_, i) => i !== idx).join(' ').trim();
  }
  const serialized = value.includes(' ') ? `${kind}:"${value}"` : `${kind}:${value}`;
  return [...parts, serialized].join(' ').trim();
}

export function toggleHasReview(query: string): string {
  const parts = tokenize(query);
  const idx = parts.findIndex((t) => t === 'has-review');
  if (idx >= 0) return parts.filter((_, i) => i !== idx).join(' ');
  return [...parts, 'has-review'].join(' ').trim();
}
