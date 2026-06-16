import type { CardForRenderer } from '../shared/types.js';

export type ExportCard = CardForRenderer & {
  set_name: string;
  collection_name: string;
};

export type ExportFormat = 'moxfield' | 'deckbox' | 'manabox' | 'mimir-native';

// ── CSV primitives ────────────────────────────────────────────────────────────

function csvField(value: string | number | null | boolean | undefined): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(fields: (string | number | null | boolean | undefined)[]): string {
  return fields.map(csvField).join(',');
}

// ── Condition/language mappings ───────────────────────────────────────────────

const MOXFIELD_CONDITIONS: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

const DECKBOX_CONDITIONS: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Good (Lightly Played)',
  MP: 'Played',
  HP: 'Heavily Played',
  DMG: 'Poor',
};

const DECKBOX_LANGUAGES: Record<string, string> = {
  EN: 'English',
  DE: 'German',
  FR: 'French',
  IT: 'Italian',
  PT: 'Portuguese',
  ES: 'Spanish',
  JA: 'Japanese',
  KO: 'Korean',
  RU: 'Russian',
  CS: 'Simplified Chinese',
  CT: 'Traditional Chinese',
};

// ── Format adapters ───────────────────────────────────────────────────────────

export function toMoxfieldCsv(cards: ExportCard[]): string {
  const header = 'Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number';
  const dataRows = cards.map((c) =>
    csvRow([
      c.quantity,
      0,
      c.name,
      c.set_name,
      MOXFIELD_CONDITIONS[c.condition] ?? c.condition,
      c.language,
      c.foil !== 'normal' ? 'foil' : '',
      '',
      '',
      c.collector_number,
    ]),
  );
  return [header, ...dataRows].join('\n');
}

export function toDeckboxCsv(cards: ExportCard[]): string {
  const header = "Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Textless,Signed,Collector's Edition,Alter,Proxy";
  const dataRows = cards.map((c) =>
    csvRow([
      c.quantity,
      0,
      c.name,
      c.set_name,
      c.collector_number,
      DECKBOX_CONDITIONS[c.condition] ?? c.condition,
      DECKBOX_LANGUAGES[c.language] ?? c.language,
      c.foil !== 'normal' ? 'foil' : '',
      '',
      '',
      '',
      '',
      '',
    ]),
  );
  return [header, ...dataRows].join('\n');
}

export function toManaBoxCsv(cards: ExportCard[]): string {
  const header = 'Name,Set code,Collector number,Foil,Condition,Language,Quantity,Purchase price';
  const dataRows = cards.map((c) =>
    csvRow([
      c.name,
      c.set_code.toLowerCase(),
      c.collector_number,
      c.foil,
      c.condition,
      c.language,
      c.quantity,
      c.price_usd != null ? c.price_usd.toFixed(2) : '',
    ]),
  );
  return [header, ...dataRows].join('\n');
}

const NATIVE_HEADER =
  'id,scryfall_id,name,set_code,set_name,collector_number,collection_id,collection_name,foil,condition,language,quantity,price_usd,notes,needs_review,review_reasons,first_seen_at,last_seen_at';

export function toMimirNativeCsv(cards: ExportCard[]): string {
  const dataRows = cards.map((c) =>
    csvRow([
      c.id,
      c.scryfall_id,
      c.name,
      c.set_code,
      c.set_name,
      c.collector_number,
      c.collection_id,
      c.collection_name,
      c.foil,
      c.condition,
      c.language,
      c.quantity,
      c.price_usd != null ? c.price_usd.toFixed(2) : '',
      c.notes ?? '',
      c.needs_review ? '1' : '0',
      c.review_reasons ?? '',
      c.first_seen_at,
      c.last_seen_at,
    ]),
  );
  return [NATIVE_HEADER, ...dataRows].join('\n');
}

// ── Mimir-native parser ───────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

function nullStr(v: string): string | null {
  return v === '' ? null : v;
}

export function parseMimirNativeCsv(csv: string): ExportCard[] {
  const lines = csv.split('\n');
  // Skip header row
  return lines.slice(1).filter((l) => l.trim() !== '').map((line) => {
    const cols = parseCsvLine(line);
    const [
      id, scryfall_id, name, set_code, set_name, collector_number,
      collection_id, collection_name, foil, condition, language,
      quantity, price_usd, notes, needs_review, review_reasons,
      first_seen_at, last_seen_at,
    ] = cols;

    return {
      id: Number(id),
      scryfall_id: scryfall_id ?? '',
      name: name ?? '',
      set_code: set_code ?? '',
      set_name: set_name ?? '',
      collector_number: collector_number ?? '',
      collection_id: Number(collection_id),
      collection_name: collection_name ?? '',
      foil: (foil ?? 'normal') as ExportCard['foil'],
      condition: (condition ?? 'NM') as ExportCard['condition'],
      language: language ?? 'EN',
      quantity: Number(quantity),
      price_usd: price_usd === '' ? null : Number(price_usd),
      notes: nullStr(notes ?? ''),
      needs_review: needs_review === '1',
      review_reasons: nullStr(review_reasons ?? ''),
      first_seen_at: Number(first_seen_at),
      last_seen_at: Number(last_seen_at),
      art_crop_path: null,
    };
  });
}
