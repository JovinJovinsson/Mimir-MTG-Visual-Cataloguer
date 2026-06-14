import type { CardForRenderer } from '../shared/types.js';
import type {
  AutocompleteHitDto,
  BootstrapPhase,
  BootstrapStatusDto,
  SetDownloadStatus,
  SetProgressDto,
  SetWithStatusDto,
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

// --- Manage Sets page ---

const setsBody = document.getElementById('sets-body') as HTMLTableSectionElement;
const setsSummary = document.getElementById('sets-summary') as HTMLDivElement;
const setsCountBadge = document.getElementById('sets-count') as HTMLSpanElement;
const navItems = Array.from(
  document.querySelectorAll<HTMLLIElement>('#sidebar .nav-item'),
);
const pages = Array.from(document.querySelectorAll<HTMLElement>('main .page'));

const setProgress = new Map<string, SetProgressDto>();
let setsCache: SetWithStatusDto[] = [];

let currentPage = 'catalogue';

function setActivePage(page: string): void {
  const leaving = currentPage;
  currentPage = page;

  for (const item of navItems) {
    item.classList.toggle('active', item.dataset['page'] === page);
  }
  for (const section of pages) {
    section.hidden = section.dataset['page'] !== page;
  }

  if (leaving === 'scan' && page !== 'scan') {
    stopCamera();
  }

  if (page === 'sets') {
    void refreshSets();
  } else if (page === 'scan') {
    void enterScanPage();
  }
}

for (const item of navItems) {
  item.addEventListener('click', () => {
    const page = item.dataset['page'];
    if (!page) return;
    if (page === 'scan' && scannerRow.classList.contains('is-locked')) return;
    setActivePage(page);
  });
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function statusLabel(s: SetDownloadStatus): string {
  switch (s) {
    case 'none': return 'Not downloaded';
    case 'downloading': return 'Downloading…';
    case 'complete': return 'Complete';
    case 'error': return 'Partial / error';
  }
}

function renderSetRow(set: SetWithStatusDto): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.dataset['setCode'] = set.code;

  const td = (cls: string, content: Node | string): HTMLTableCellElement => {
    const cell = document.createElement('td');
    cell.className = cls;
    if (typeof content === 'string') cell.textContent = content;
    else cell.appendChild(content);
    return cell;
  };

  tr.appendChild(td('cell-set-code', set.code.toUpperCase()));
  tr.appendChild(td('cell-set-name', set.name));
  tr.appendChild(td('cell-set-cards', String(set.card_count)));
  tr.appendChild(td('cell-set-disk', formatBytes(set.estimated_disk_bytes)));

  const progressCell = document.createElement('td');
  progressCell.className = 'cell-set-progress';
  const live = setProgress.get(set.code);
  const downloaded = live?.downloaded ?? set.hashed_count;
  const total = live?.total ?? set.card_count;
  const status = live?.status ?? set.download_status;
  const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : (status === 'complete' ? 100 : 0);
  const label = document.createElement('div');
  label.className = 'set-progress-label';
  const phase = document.createElement('span');
  phase.className = `set-status set-status--${status}`;
  phase.textContent = statusLabel(status);
  const detail = document.createElement('span');
  detail.className = 'muted';
  detail.textContent =
    status === 'downloading' || (status === 'error' && total > 0)
      ? `${downloaded.toLocaleString()} / ${total.toLocaleString()}`
      : status === 'complete' && total > 0
        ? `${total.toLocaleString()} crops`
        : '';
  label.appendChild(phase);
  label.appendChild(detail);
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  const fill = document.createElement('div');
  fill.className = 'progress-bar-fill';
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  progressCell.appendChild(label);
  progressCell.appendChild(bar);
  tr.appendChild(progressCell);

  const toggleCell = document.createElement('td');
  toggleCell.className = 'cell-set-toggle';
  const label2 = document.createElement('label');
  label2.className = 'switch';
  const input2 = document.createElement('input');
  input2.type = 'checkbox';
  const enabled = set.is_downloaded === 1 || status === 'downloading';
  input2.checked = enabled;
  input2.disabled = status === 'downloading';
  input2.addEventListener('change', async () => {
    const wantEnabled = input2.checked;
    input2.disabled = true;
    const res = await window.mimir.setsToggleDownload({
      setCode: set.code,
      enabled: wantEnabled,
    });
    if (!res.ok) {
      setStatus(res.error, 'error');
      input2.checked = !wantEnabled;
      input2.disabled = false;
      return;
    }
    // refresh in a moment; progress events will keep state fresh.
    setTimeout(() => { void refreshSets(); }, 80);
  });
  const slider = document.createElement('span');
  slider.className = 'slider';
  label2.appendChild(input2);
  label2.appendChild(slider);
  toggleCell.appendChild(label2);
  tr.appendChild(toggleCell);

  return tr;
}

function renderSetsTable(sets: SetWithStatusDto[]): void {
  setsBody.innerHTML = '';
  if (sets.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'No sets indexed yet.';
    tr.appendChild(td);
    setsBody.appendChild(tr);
    return;
  }
  for (const set of sets) setsBody.appendChild(renderSetRow(set));
}

function renderSetsSummary(sets: SetWithStatusDto[]): void {
  const downloaded = sets.filter((s) => s.is_downloaded === 1).length;
  setsSummary.textContent =
    sets.length === 0
      ? 'No sets indexed yet — finish the first-run bootstrap first.'
      : `${downloaded.toLocaleString()} of ${sets.length.toLocaleString()} sets downloaded`;
  setsCountBadge.textContent = sets.length === 0 ? '—' : `${downloaded}/${sets.length}`;
}

async function refreshSets(): Promise<void> {
  const res = await window.mimir.setsList();
  if (!res.ok) {
    setStatus(`Failed to load sets: ${res.error}`, 'error');
    return;
  }
  setsCache = res.sets;
  renderSetsSummary(setsCache);
  renderSetsTable(setsCache);
}

window.mimir.onSetsProgress((event) => {
  setProgress.set(event.setCode, event);
  // If the set finished, drop the live entry once a refresh confirms it.
  if (event.status === 'complete' || event.status === 'none' || event.status === 'error') {
    void refreshSets();
  } else {
    // patch the single row in place to keep the UI responsive
    const row = setsBody.querySelector<HTMLTableRowElement>(`tr[data-set-code="${event.setCode}"]`);
    const set = setsCache.find((s) => s.code === event.setCode);
    if (row && set) {
      row.replaceWith(renderSetRow(set));
    }
  }
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
  await refreshSets();
})();

// --- Scan page ---

const scanVideo = document.getElementById('scan-video') as HTMLVideoElement;
const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement;
const scanErrorEl = document.getElementById('scan-error') as HTMLDivElement;
const scanErrorMessage = document.getElementById('scan-error-message') as HTMLSpanElement;
const scanRetryBtn = document.getElementById('scan-retry-btn') as HTMLButtonElement;
const scanPermissionPrompt = document.getElementById('scan-permission-prompt') as HTMLDivElement;
const scanRequestPermissionBtn = document.getElementById('scan-request-permission-btn') as HTMLButtonElement;
const scanRecentsStrip = document.getElementById('scan-recents-strip') as HTMLDivElement;

let activeStream: MediaStream | null = null;

function stopCamera(): void {
  if (activeStream) {
    for (const track of activeStream.getTracks()) track.stop();
    activeStream = null;
  }
  scanVideo.srcObject = null;
  captureBtn.disabled = true;
}

function showScanError(msg: string): void {
  scanErrorMessage.textContent = msg;
  scanErrorEl.hidden = false;
  captureBtn.disabled = true;
}

function hideScanError(): void {
  scanErrorEl.hidden = true;
}

async function populateCameraList(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    cameraSelect.innerHTML = '';
    if (cameras.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No cameras found';
      cameraSelect.appendChild(opt);
    } else {
      cameras.forEach((cam, i) => {
        const opt = document.createElement('option');
        opt.value = cam.deviceId;
        opt.textContent = cam.label || `Camera ${i + 1}`;
        cameraSelect.appendChild(opt);
      });
    }
    return cameras;
  } catch {
    return [];
  }
}

async function startCamera(deviceId?: string): Promise<void> {
  stopCamera();
  hideScanError();
  scanPermissionPrompt.hidden = true;

  const constraints: MediaStreamConstraints = {
    video: deviceId ? { deviceId: { exact: deviceId } } : true,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    activeStream = stream;
    scanVideo.srcObject = stream;

    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        showScanError('Camera disconnected — select another camera or reconnect.');
        captureBtn.disabled = true;
      };
    }

    captureBtn.disabled = false;

    await populateCameraList();
    const currentId = track?.getSettings().deviceId ?? '';
    if (currentId) {
      cameraSelect.value = currentId;
      void window.mimir.settingsSet({ key: 'preferredCameraId', value: currentId });
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError') {
      scanPermissionPrompt.hidden = false;
      showScanError('Camera permission denied. Click "Allow Camera" above.');
    } else if (name === 'NotFoundError') {
      showScanError('No camera found. Connect a camera and try again.');
    } else {
      showScanError(err instanceof Error ? err.message : 'Camera error');
    }
  }
}

function renderRecentScans(scans: import('../shared/types.js').ScanForRenderer[]): void {
  scanRecentsStrip.innerHTML = '';
  if (scans.length === 0) {
    const span = document.createElement('span');
    span.className = 'scan-recents-empty';
    span.textContent = 'No captures yet';
    scanRecentsStrip.appendChild(span);
    return;
  }
  for (const scan of scans) {
    const wrap = document.createElement('div');
    wrap.className = 'scan-recent-thumb';
    if (scan.thumbnail_path) {
      const img = document.createElement('img');
      img.src = `file://${scan.thumbnail_path}`;
      img.alt = `Scan ${scan.id}`;
      wrap.appendChild(img);
    }
    const t = document.createElement('time');
    t.textContent = new Date(scan.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrap.appendChild(t);
    scanRecentsStrip.appendChild(wrap);
  }
}

async function loadRecentScans(): Promise<void> {
  const res = await window.mimir.scansListRecent(8);
  if (res.ok) renderRecentScans(res.scans);
}

async function enterScanPage(): Promise<void> {
  await loadRecentScans();
  const prefRes = await window.mimir.settingsGet({ key: 'preferredCameraId' });
  const preferredId = prefRes.ok ? (prefRes.value ?? undefined) : undefined;
  await startCamera(preferredId);
}

cameraSelect.addEventListener('change', () => {
  const deviceId = cameraSelect.value;
  if (deviceId) void startCamera(deviceId);
});

captureBtn.addEventListener('click', async () => {
  if (!activeStream) return;
  captureBtn.disabled = true;

  const canvas = document.createElement('canvas');
  canvas.width = scanVideo.videoWidth || 640;
  canvas.height = scanVideo.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) { captureBtn.disabled = false; return; }
  ctx.drawImage(scanVideo, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  try {
    const res = await window.mimir.scansCapture({ dataUrl });
    if (!res.ok) {
      showScanError(`Capture failed: ${res.error}`);
    } else {
      await loadRecentScans();
    }
  } catch (err) {
    showScanError(err instanceof Error ? err.message : 'Capture failed');
  } finally {
    captureBtn.disabled = false;
  }
});

scanRetryBtn.addEventListener('click', () => {
  const deviceId = cameraSelect.value || undefined;
  void startCamera(deviceId);
});

scanRequestPermissionBtn.addEventListener('click', () => {
  void startCamera(undefined);
});
