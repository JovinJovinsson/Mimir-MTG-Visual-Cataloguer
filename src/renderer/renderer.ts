import type { CardForRenderer } from '../shared/types.js';
import type {
  AutocompleteHitDto,
  BootstrapPhase,
  BootstrapStatusDto,
} from '../shared/ipc.js';

const form = document.getElementById('add-card-form') as HTMLFormElement;
const input = document.getElementById('card-name-input') as HTMLInputElement;
const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
const tableBody = document.getElementById('catalogue-body') as HTMLTableSectionElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const inboxCountEl = document.getElementById('inbox-count') as HTMLSpanElement;
const scannerRow = document.getElementById('scanner-row') as HTMLLIElement;
const scannerGate = document.getElementById('scanner-gate') as HTMLSpanElement;
const autocompleteList = document.getElementById('autocomplete-list') as HTMLUListElement;
const bannerEl = document.getElementById('bootstrap-banner') as HTMLDivElement;
const bannerPhase = document.getElementById('bootstrap-banner-phase') as HTMLSpanElement;
const bannerDetail = document.getElementById('bootstrap-banner-detail') as HTMLSpanElement;
const bannerFill = document.getElementById('bootstrap-banner-fill') as HTMLDivElement;

const wizardOverlay = document.getElementById('wizard-overlay') as HTMLDivElement;
const wizardFullBtn = document.getElementById('wizard-full') as HTMLButtonElement;
const wizardProgress = document.getElementById('wizard-progress') as HTMLDivElement;
const wizardPhaseLabel = document.getElementById('wizard-phase-label') as HTMLSpanElement;
const wizardProgressCount = document.getElementById('wizard-progress-count') as HTMLSpanElement;
const wizardProgressFill = document.getElementById('wizard-progress-fill') as HTMLDivElement;
const wizardClose = document.getElementById('wizard-close') as HTMLButtonElement;
const wizardError = document.getElementById('wizard-error') as HTMLDivElement;
const wizardErrorMessage = document.getElementById('wizard-error-message') as HTMLSpanElement;
const wizardRetry = document.getElementById('wizard-retry') as HTMLButtonElement;
const wizardOptions = wizardFullBtn.parentElement as HTMLDivElement;

interface AutocompleteState {
  hits: AutocompleteHitDto[];
  activeIndex: number;
  selected: AutocompleteHitDto | null;
}

const acState: AutocompleteState = { hits: [], activeIndex: -1, selected: null };
let acDebounce: ReturnType<typeof setTimeout> | null = null;

function setStatus(message: string, kind: 'ok' | 'error' | ''): void {
  statusEl.textContent = message;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function formatPrice(p: number | null): string {
  if (p == null) return '—';
  return `$${p.toFixed(2)}`;
}

function formatLastSeen(ts: number): string {
  return new Date(ts).toLocaleString();
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
  td.textContent = 'No cards yet — add one by name above.';
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

// --- Autocomplete ---

function closeAutocomplete(): void {
  autocompleteList.hidden = true;
  autocompleteList.innerHTML = '';
  acState.hits = [];
  acState.activeIndex = -1;
}

function clearSelection(): void {
  acState.selected = null;
  submitButton.disabled = true;
}

function renderAutocomplete(): void {
  autocompleteList.innerHTML = '';
  if (acState.hits.length === 0) {
    autocompleteList.hidden = true;
    return;
  }
  acState.hits.forEach((hit, i) => {
    const li = document.createElement('li');
    if (i === acState.activeIndex) li.classList.add('is-active');
    const name = document.createElement('span');
    name.className = 'autocomplete-name';
    name.textContent = hit.name;
    const meta = document.createElement('span');
    meta.className = 'autocomplete-meta';
    meta.textContent = `${hit.set_code} · #${hit.collector_number}`;
    li.appendChild(name);
    li.appendChild(meta);
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      chooseHit(i);
    });
    autocompleteList.appendChild(li);
  });
  autocompleteList.hidden = false;
}

function chooseHit(i: number): void {
  const hit = acState.hits[i];
  if (!hit) return;
  acState.selected = hit;
  input.value = `${hit.name} — ${hit.set_code.toUpperCase()} #${hit.collector_number}`;
  submitButton.disabled = false;
  closeAutocomplete();
}

async function runAutocomplete(query: string): Promise<void> {
  if (query.length < 2) {
    closeAutocomplete();
    return;
  }
  const res = await window.mimir.autocompleteByName(query, 12);
  if (!res.ok) {
    setStatus(res.error, 'error');
    return;
  }
  acState.hits = res.hits;
  acState.activeIndex = res.hits.length > 0 ? 0 : -1;
  renderAutocomplete();
}

input.addEventListener('input', () => {
  clearSelection();
  if (acDebounce) clearTimeout(acDebounce);
  const query = input.value.trim();
  acDebounce = setTimeout(() => { void runAutocomplete(query); }, 80);
});

input.addEventListener('keydown', (e) => {
  if (autocompleteList.hidden) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acState.activeIndex = Math.min(acState.hits.length - 1, acState.activeIndex + 1);
    renderAutocomplete();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acState.activeIndex = Math.max(0, acState.activeIndex - 1);
    renderAutocomplete();
  } else if (e.key === 'Enter') {
    if (acState.activeIndex >= 0) {
      e.preventDefault();
      chooseHit(acState.activeIndex);
    }
  } else if (e.key === 'Escape') {
    closeAutocomplete();
  }
});

input.addEventListener('blur', () => {
  setTimeout(closeAutocomplete, 100);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const hit = acState.selected;
  if (!hit) return;

  submitButton.disabled = true;
  setStatus(`Adding ${hit.name}…`, '');
  try {
    const res = await window.mimir.addCardByName({ scryfall_id: hit.scryfall_id });
    if (!res.ok) {
      setStatus(res.error, 'error');
      submitButton.disabled = false;
      return;
    }
    const verb = res.created ? 'Added' : 'Quantity bumped on';
    setStatus(`${verb}: ${res.card.name} (${res.card.set_code.toUpperCase()} ${res.card.collector_number})`, 'ok');
    input.value = '';
    clearSelection();
    await refresh();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
    submitButton.disabled = false;
  } finally {
    input.focus();
  }
});

// --- Bootstrap / first-run wizard ---

function phaseLabel(phase: BootstrapPhase): string {
  switch (phase) {
    case 'idle': return 'Ready to start';
    case 'fetching-manifest': return 'Locating the latest Scryfall bulk file…';
    case 'downloading': return 'Downloading card data from Scryfall…';
    case 'ingesting': return 'Indexing cards locally…';
    case 'done': return 'Card data ready.';
    case 'error': return 'Bootstrap failed';
  }
}

function progressPercent(s: BootstrapStatusDto): number {
  if (s.phase === 'done') return 100;
  if (s.phase === 'ingesting' && s.totalCards) {
    return Math.min(100, Math.round((s.ingestedCards / s.totalCards) * 100));
  }
  if (s.phase === 'downloading') return 15;
  if (s.phase === 'fetching-manifest') return 5;
  return 0;
}

function applyStatusToBanner(s: BootstrapStatusDto): void {
  const showBanner =
    !wizardOverlay.hidden ? false : s.phase !== 'idle' && s.phase !== 'done';
  bannerEl.hidden = !showBanner;
  bannerPhase.textContent = phaseLabel(s.phase);
  bannerDetail.textContent =
    s.phase === 'ingesting' && s.totalCards
      ? `${s.ingestedCards.toLocaleString()} / ${s.totalCards.toLocaleString()} cards`
      : '';
  bannerFill.style.width = `${progressPercent(s)}%`;
}

function applyStatusToWizard(s: BootstrapStatusDto): void {
  if (wizardOverlay.hidden) return;
  if (s.phase === 'idle') {
    wizardProgress.hidden = true;
    wizardError.hidden = true;
    wizardOptions.hidden = false;
    return;
  }
  if (s.phase === 'error') {
    wizardProgress.hidden = true;
    wizardError.hidden = false;
    wizardOptions.hidden = false;
    wizardErrorMessage.textContent = s.error ?? 'Unknown error';
    return;
  }
  wizardOptions.hidden = true;
  wizardError.hidden = true;
  wizardProgress.hidden = false;
  wizardPhaseLabel.textContent = phaseLabel(s.phase);
  wizardProgressCount.textContent =
    s.phase === 'ingesting' && s.totalCards
      ? `${s.ingestedCards.toLocaleString()} / ${s.totalCards.toLocaleString()}`
      : '';
  wizardProgressFill.style.width = `${progressPercent(s)}%`;
  wizardClose.hidden = s.phase !== 'done';
}

function applyScannerGate(s: BootstrapStatusDto): void {
  if (s.scannerGateOpen) {
    scannerRow.classList.add('is-open');
    scannerRow.classList.remove('is-locked');
    scannerGate.textContent = 'open';
  } else {
    scannerRow.classList.add('is-locked');
    scannerRow.classList.remove('is-open');
    scannerGate.textContent = 'locked';
  }
}

function hideWizard(): void {
  wizardOverlay.hidden = true;
}

function showWizard(): void {
  wizardOverlay.hidden = false;
  wizardProgress.hidden = true;
  wizardError.hidden = true;
  wizardOptions.hidden = false;
}

async function startBootstrap(): Promise<void> {
  wizardOptions.hidden = true;
  wizardError.hidden = true;
  wizardProgress.hidden = false;
  wizardPhaseLabel.textContent = 'Connecting to Scryfall…';
  wizardProgressFill.style.width = '5%';
  const res = await window.mimir.bootstrapStart({ selection: 'full' });
  if (!res.ok) {
    wizardProgress.hidden = true;
    wizardError.hidden = false;
    wizardErrorMessage.textContent = res.error;
    wizardOptions.hidden = false;
  }
}

wizardFullBtn.addEventListener('click', () => { void startBootstrap(); });
wizardRetry.addEventListener('click', () => { void startBootstrap(); });
wizardClose.addEventListener('click', () => { hideWizard(); void refresh(); });

window.mimir.onBootstrapProgress((status) => {
  applyStatusToWizard(status);
  applyStatusToBanner(status);
  applyScannerGate(status);
});

void (async () => {
  const status = await window.mimir.bootstrapStatus();
  applyScannerGate(status);
  if (!status.scannerGateOpen && status.phase === 'idle') {
    showWizard();
  } else if (status.phase !== 'idle' && status.phase !== 'done') {
    showWizard();
    applyStatusToWizard(status);
  } else {
    applyStatusToBanner(status);
  }
  await refresh();
})();
