import type { CardForRenderer } from '../shared/types.js';

const form = document.getElementById('add-card-form') as HTMLFormElement;
const input = document.getElementById('scryfall-id-input') as HTMLInputElement;
const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
const tableBody = document.getElementById('catalogue-body') as HTMLTableSectionElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const inboxCountEl = document.getElementById('inbox-count') as HTMLSpanElement;

function setStatus(message: string, kind: 'ok' | 'error' | ''): void {
  statusEl.textContent = message;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function formatPrice(p: number | null): string {
  if (p == null) return '—';
  return `$${p.toFixed(2)}`;
}

function formatLastSeen(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

function renderRow(card: CardForRenderer): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.dataset['cardId'] = String(card.id);

  const cells: [string, string | Node][] = [
    ['col-thumb', spanThumb()],
    ['col-name', card.name],
    ['col-set', spanSet(card.set_code)],
    ['col-cn', card.collector_number],
    ['col-qty', String(card.quantity)],
    ['col-foil', spanFoil(card.foil)],
    ['col-cond', card.condition],
    ['col-price cell-price', formatPrice(card.price_usd)],
    ['col-seen cell-seen', formatLastSeen(card.last_seen_at)],
  ];

  for (const [cls, content] of cells) {
    const td = document.createElement('td');
    td.className = cls;
    if (typeof content === 'string') td.textContent = content;
    else td.appendChild(content);
    tr.appendChild(td);
  }
  return tr;
}

function spanThumb(): Node {
  const s = document.createElement('span');
  s.className = 'thumb-placeholder';
  return s;
}

function spanSet(code: string): Node {
  const s = document.createElement('span');
  s.className = 'cell-set';
  s.textContent = code;
  return s;
}

function spanFoil(foil: string): Node {
  const s = document.createElement('span');
  s.className = `cell-foil is-${foil}`;
  s.textContent = foil;
  return s;
}

function renderEmpty(): void {
  tableBody.innerHTML = '';
  const tr = document.createElement('tr');
  tr.className = 'empty-row';
  const td = document.createElement('td');
  td.colSpan = 9;
  td.textContent = 'No cards yet — add one by Scryfall ID above.';
  tr.appendChild(td);
  tableBody.appendChild(tr);
}

function renderCards(cards: CardForRenderer[]): void {
  if (cards.length === 0) {
    renderEmpty();
    inboxCountEl.textContent = '0';
    return;
  }
  tableBody.innerHTML = '';
  for (const card of cards) tableBody.appendChild(renderRow(card));
  const totalQty = cards.reduce((acc, c) => acc + c.quantity, 0);
  inboxCountEl.textContent = String(totalQty);
}

async function refresh(): Promise<void> {
  const res = await window.mimir.listCards();
  if (!res.ok) {
    setStatus(`Failed to load catalogue: ${res.error}`, 'error');
    return;
  }
  renderCards(res.cards);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = input.value.trim();
  if (!id) return;

  submitButton.disabled = true;
  setStatus(`Fetching ${id} from Scryfall…`, '');
  try {
    const res = await window.mimir.addCardById({ scryfall_id: id });
    if (!res.ok) {
      setStatus(res.error, 'error');
      return;
    }
    const verb = res.created ? 'Added' : 'Quantity bumped on';
    setStatus(`${verb}: ${res.card.name} (${res.card.set_code.toUpperCase()} ${res.card.collector_number})`, 'ok');
    input.value = '';
    await refresh();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    submitButton.disabled = false;
    input.focus();
  }
});

void refresh();
