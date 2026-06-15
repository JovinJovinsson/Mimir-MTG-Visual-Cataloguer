import type { CardForRenderer, CollectionForRenderer, ScanModePreset } from '../shared/types.js';
import { initState, step } from './card-detector.js';
import type { DetectorState } from './card-detector.js';
import { detectCard } from './frame-detector.js';
import { warpCard } from './perspective-warp.js';
import type {
  AutocompleteHitDto,
  BootstrapPhase,
  BootstrapStatusDto,
  ReviewCountDto,
  ReviewItemDto,
  ScanQueueDepthDto,
  SetDownloadStatus,
  SetProgressDto,
  SetWithStatusDto,
} from '../shared/ipc.js';

// ── ReviewPanelController ─────────────────────────────────────────────────────
//
// Shared class used by both the dedicated Review page and the scan-screen
// slide-out. Each instance owns its own DOM refs and state; the same business
// logic paths are followed regardless of where the panel is mounted.

interface ReviewPanelDom {
  empty: HTMLDivElement;
  content: HTMLDivElement;
  snapshot: HTMLImageElement;
  reasonBadge: HTMLDivElement;
  itemMeta: HTMLDivElement;
  toggleGallery: HTMLButtonElement;
  toggleList: HTMLButtonElement;
  gallery: HTMLDivElement;
  list: HTMLDivElement;
  listBody: HTMLTableSectionElement;
  btnConfirm: HTMLButtonElement;
  btnSkip: HTMLButtonElement;
  btnDismiss: HTMLButtonElement;
  fieldCorrections?: HTMLDivElement;
  foilFoilRow?: HTMLDivElement;
  foilSelect?: HTMLSelectElement;
  langRow?: HTMLDivElement;
  langInput?: HTMLInputElement;
  pendingLabel?: HTMLElement;
  onItemActioned?: () => Promise<void>;
}

class ReviewPanelController {
  private dom: ReviewPanelDom;
  private _currentItem: ReviewItemDto | null = null;
  private _selectedIndex = -1;
  private viewMode: 'gallery' | 'list' = 'gallery';

  constructor(dom: ReviewPanelDom) {
    this.dom = dom;
    this.bindActions();
  }

  get currentItem(): ReviewItemDto | null { return this._currentItem; }
  get btnConfirm(): HTMLButtonElement { return this.dom.btnConfirm; }
  get btnSkip(): HTMLButtonElement { return this.dom.btnSkip; }
  get btnDismiss(): HTMLButtonElement { return this.dom.btnDismiss; }

  showItem(item: ReviewItemDto): void {
    this.renderItem(item);
  }

  selectCandidate(index: number): void {
    if (!this._currentItem) return;
    if (index < 0 || index >= this._currentItem.candidates.length) return;
    this._selectedIndex = index;
    this.dom.btnConfirm.disabled = false;
    const cards = this.dom.gallery.querySelectorAll<HTMLDivElement>('.review-candidate');
    cards.forEach((c, i) => c.classList.toggle('is-selected', i === index));
    const rows = this.dom.listBody.querySelectorAll<HTMLTableRowElement>('tr');
    rows.forEach((r, i) => r.classList.toggle('is-selected', i === index));
  }

  private applyViewMode(): void {
    const isGallery = this.viewMode === 'gallery';
    this.dom.gallery.hidden = !isGallery;
    this.dom.list.hidden = isGallery;
    this.dom.toggleGallery.classList.toggle('is-active', isGallery);
    this.dom.toggleList.classList.toggle('is-active', !isGallery);
  }

  private renderGallery(item: ReviewItemDto): void {
    this.dom.gallery.innerHTML = '';
    item.candidates.forEach((candidate, i) => {
      const div = document.createElement('div');
      div.className = 'review-candidate';
      if (i === this._selectedIndex) div.classList.add('is-selected');

      const keyBadge = document.createElement('div');
      keyBadge.className = 'review-candidate-key';
      keyBadge.textContent = String(i + 1);
      div.appendChild(keyBadge);

      if (candidate.artCropPath) {
        const img = document.createElement('img');
        img.className = 'review-candidate-art';
        img.src = `file://${candidate.artCropPath}`;
        img.alt = candidate.name;
        div.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'review-candidate-art-placeholder';
        placeholder.textContent = 'No art';
        div.appendChild(placeholder);
      }

      const body = document.createElement('div');
      body.className = 'review-candidate-body';
      const name = document.createElement('div');
      name.className = 'review-candidate-name';
      name.textContent = candidate.name;
      body.appendChild(name);
      const meta = document.createElement('div');
      meta.className = 'review-candidate-meta';
      meta.textContent = `${candidate.setCode.toUpperCase()} #${candidate.collectorNumber}`;
      body.appendChild(meta);
      div.appendChild(body);

      div.addEventListener('click', () => this.selectCandidate(i));
      this.dom.gallery.appendChild(div);
    });
  }

  private renderList(item: ReviewItemDto): void {
    this.dom.listBody.innerHTML = '';
    item.candidates.forEach((candidate, i) => {
      const tr = document.createElement('tr');
      if (i === this._selectedIndex) tr.classList.add('is-selected');

      const tdKey = document.createElement('td');
      tdKey.className = 'rl-key';
      tdKey.textContent = String(i + 1);
      tr.appendChild(tdKey);

      const tdName = document.createElement('td');
      tdName.textContent = candidate.name;
      tr.appendChild(tdName);

      const tdSet = document.createElement('td');
      tdSet.className = 'rl-set';
      tdSet.textContent = candidate.setCode.toUpperCase();
      tr.appendChild(tdSet);

      const tdCn = document.createElement('td');
      tdCn.className = 'rl-cn';
      tdCn.textContent = candidate.collectorNumber;
      tr.appendChild(tdCn);

      const tdDist = document.createElement('td');
      tdDist.className = 'rl-dist';
      tdDist.textContent = String(candidate.hammingDistance);
      tr.appendChild(tdDist);

      const tdPrice = document.createElement('td');
      tdPrice.className = 'rl-price';
      tdPrice.textContent = formatPrice(candidate.priceUsd);
      tr.appendChild(tdPrice);

      tr.addEventListener('click', () => this.selectCandidate(i));
      this.dom.listBody.appendChild(tr);
    });
  }

  private renderItem(item: ReviewItemDto): void {
    this._currentItem = item;
    this._selectedIndex = -1;

    if (item.thumbnailPath) {
      this.dom.snapshot.src = `file://${item.thumbnailPath}`;
      this.dom.snapshot.hidden = false;
    } else {
      this.dom.snapshot.src = '';
      this.dom.snapshot.hidden = true;
    }

    this.dom.reasonBadge.textContent = reasonLabel(item.reason);
    this.dom.reasonBadge.className = `review-reason-badge reason-${item.reason}`;

    if (item.reason === 'low_confidence_field') {
      this.renderFieldCorrectionMode(item);
    } else {
      this.renderCandidateMode(item);
    }

    this.dom.empty.hidden = true;
    this.dom.content.hidden = false;
  }

  private renderCandidateMode(item: ReviewItemDto): void {
    this.dom.btnConfirm.disabled = true;
    this.dom.itemMeta.textContent =
      `Captured ${new Date(item.capturedAt).toLocaleString()} · ${item.candidates.length} candidate(s)`;

    // Show candidate picker, hide field corrections
    this.dom.toggleGallery.hidden = false;
    this.dom.toggleList.hidden = false;
    if (this.dom.fieldCorrections) this.dom.fieldCorrections.hidden = true;

    this.renderGallery(item);
    this.renderList(item);
    this.applyViewMode();
  }

  private renderFieldCorrectionMode(item: ReviewItemDto): void {
    // Hide candidate picker, show field correction inputs
    this.dom.toggleGallery.hidden = true;
    this.dom.toggleList.hidden = true;
    this.dom.gallery.hidden = true;
    this.dom.list.hidden = true;

    const flagged = item.flaggedFields ?? [];
    const inferred = item.inferredValues ?? {};

    this.dom.itemMeta.textContent =
      `Captured ${new Date(item.capturedAt).toLocaleString()} · Please confirm the flagged field(s)`;

    if (this.dom.fieldCorrections) {
      this.dom.fieldCorrections.hidden = false;

      if (this.dom.foilFoilRow && this.dom.foilSelect) {
        this.dom.foilFoilRow.hidden = !flagged.includes('foil');
        if (flagged.includes('foil')) {
          this.dom.foilSelect.value = inferred['foil'] ?? 'normal';
        }
      }

      if (this.dom.langRow && this.dom.langInput) {
        this.dom.langRow.hidden = !flagged.includes('language');
        if (flagged.includes('language')) {
          this.dom.langInput.value = inferred['language'] ?? 'EN';
        }
      }
    }

    // Confirm is always enabled for field correction items
    this.dom.btnConfirm.disabled = false;
  }

  showEmpty(): void {
    this._currentItem = null;
    this._selectedIndex = -1;
    this.dom.btnConfirm.disabled = true;
    this.dom.empty.hidden = false;
    this.dom.content.hidden = true;
  }

  async loadAndRender(): Promise<void> {
    const countRes = await window.mimir.reviewCount();
    if (countRes.ok) {
      applyReviewCount(countRes.count);
      if (this.dom.pendingLabel) {
        this.dom.pendingLabel.textContent =
          countRes.count > 0 ? `${countRes.count} pending` : 'No items pending';
      }
    }

    const res = await window.mimir.reviewListPending();
    if (!res.ok) { this.showEmpty(); return; }
    const item = res.items[0];
    if (!item) { this.showEmpty(); return; }
    this.renderItem(item);
  }

  private bindActions(): void {
    this.dom.toggleGallery.addEventListener('click', () => {
      this.viewMode = 'gallery';
      this.applyViewMode();
      if (this._currentItem) this.renderGallery(this._currentItem);
    });
    this.dom.toggleList.addEventListener('click', () => {
      this.viewMode = 'list';
      this.applyViewMode();
      if (this._currentItem) this.renderList(this._currentItem);
    });
    this.dom.btnConfirm.addEventListener('click', () => { void this.handleConfirm(); });
    this.dom.btnSkip.addEventListener('click', () => { void this.handleSkip(); });
    this.dom.btnDismiss.addEventListener('click', () => { void this.handleDismiss(); });
  }

  private async handleConfirm(): Promise<void> {
    if (!this._currentItem) return;

    if (this._currentItem.reason === 'low_confidence_field') {
      await this.handleFieldCorrectionConfirm();
      return;
    }

    if (this._selectedIndex < 0) return;
    const candidate = this._currentItem.candidates[this._selectedIndex];
    if (!candidate) return;
    this.dom.btnConfirm.disabled = true;
    const res = await window.mimir.reviewConfirm({
      reviewId: this._currentItem.id,
      scryfallId: candidate.scryfallId,
    });
    if (res.ok) {
      if (this.dom.onItemActioned) {
        await this.dom.onItemActioned();
      } else {
        await this.loadAndRender();
        await refresh();
      }
    } else {
      this.dom.btnConfirm.disabled = false;
    }
  }

  private async handleFieldCorrectionConfirm(): Promise<void> {
    const item = this._currentItem;
    if (!item || item.resolvedCardId == null) return;

    const foil = (this.dom.foilSelect?.value ?? 'normal') as 'normal' | 'foil' | 'etched';
    const language = (this.dom.langInput?.value?.trim() ?? 'EN') || 'EN';

    this.dom.btnConfirm.disabled = true;
    const res = await window.mimir.reviewConfirmFieldCorrections({
      reviewId: item.id,
      cardId: item.resolvedCardId,
      foil,
      language,
    });
    if (res.ok) {
      if (this.dom.onItemActioned) {
        await this.dom.onItemActioned();
      } else {
        await this.loadAndRender();
        await refresh();
      }
    } else {
      this.dom.btnConfirm.disabled = false;
    }
  }

  private async handleSkip(): Promise<void> {
    if (!this._currentItem) return;
    await window.mimir.reviewSkip({ reviewId: this._currentItem.id });
    if (this.dom.onItemActioned) {
      await this.dom.onItemActioned();
    } else {
      await this.loadAndRender();
    }
  }

  private async handleDismiss(): Promise<void> {
    if (!this._currentItem) return;
    await window.mimir.reviewDismiss({ reviewId: this._currentItem.id });
    if (this.dom.onItemActioned) {
      await this.dom.onItemActioned();
    } else {
      await this.loadAndRender();
    }
  }
}

// ── Catalogue page elements ───────────────────────────────────────────────────

const form = document.getElementById('add-card-form') as HTMLFormElement;
const input = document.getElementById('card-name-input') as HTMLInputElement;
const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
const tableBody = document.getElementById('catalogue-body') as HTMLTableSectionElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const scannerRow = document.getElementById('scanner-row') as HTMLLIElement;
const scannerGate = document.getElementById('scanner-gate') as HTMLSpanElement;
const autocompleteList = document.getElementById('autocomplete-list') as HTMLUListElement;
const bannerEl = document.getElementById('bootstrap-banner') as HTMLDivElement;
const bannerPhase = document.getElementById('bootstrap-banner-phase') as HTMLSpanElement;
const bannerDetail = document.getElementById('bootstrap-banner-detail') as HTMLSpanElement;
const bannerFill = document.getElementById('bootstrap-banner-fill') as HTMLDivElement;

// ── Wizard elements ───────────────────────────────────────────────────────────

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

// ── Review panel: sidebar count badge ────────────────────────────────────────

const reviewCountEl = document.getElementById('review-count') as HTMLSpanElement;
const scanReviewCountEl = document.getElementById('scan-review-count') as HTMLSpanElement;

// ── Review page: queue list elements ─────────────────────────────────────────

const reviewBulkBar = document.getElementById('review-bulk-bar') as HTMLDivElement;
const reviewBulkCount = document.getElementById('review-bulk-count') as HTMLSpanElement;
const reviewBulkFoilBtn = document.getElementById('review-bulk-foil') as HTMLButtonElement;
const reviewBulkSetBtn = document.getElementById('review-bulk-set') as HTMLButtonElement;
const reviewBulkDismissAllBtn = document.getElementById('review-bulk-dismiss-all') as HTMLButtonElement;
const reviewBackWrap = document.getElementById('review-back-wrap') as HTMLDivElement;
const reviewBackBtn = document.getElementById('review-back-btn') as HTMLButtonElement;
const reviewQueueWrap = document.getElementById('review-queue-wrap') as HTMLDivElement;
const reviewQueueBody = document.getElementById('review-queue-body') as HTMLTableSectionElement;
const reviewSelectAll = document.getElementById('review-select-all') as HTMLInputElement;

let reviewItems: ReviewItemDto[] = [];
let reviewSelectedIds = new Set<number>();
let reviewLastClickedIdx = -1;
type ReviewPageMode = 'list' | 'detail';
let reviewPageMode: ReviewPageMode = 'list';

// ── Review page panel instance ────────────────────────────────────────────────

const reviewPagePanel = new ReviewPanelController({
  empty: document.getElementById('review-empty') as HTMLDivElement,
  content: document.getElementById('review-panel-content') as HTMLDivElement,
  snapshot: document.getElementById('review-snapshot') as HTMLImageElement,
  reasonBadge: document.getElementById('review-reason-badge') as HTMLDivElement,
  itemMeta: document.getElementById('review-item-meta') as HTMLDivElement,
  toggleGallery: document.getElementById('review-toggle-gallery') as HTMLButtonElement,
  toggleList: document.getElementById('review-toggle-list') as HTMLButtonElement,
  gallery: document.getElementById('review-gallery') as HTMLDivElement,
  list: document.getElementById('review-list') as HTMLDivElement,
  listBody: document.getElementById('review-list-body') as HTMLTableSectionElement,
  btnConfirm: document.getElementById('review-btn-confirm') as HTMLButtonElement,
  btnSkip: document.getElementById('review-btn-skip') as HTMLButtonElement,
  btnDismiss: document.getElementById('review-btn-dismiss') as HTMLButtonElement,
  fieldCorrections: document.getElementById('review-field-corrections') as HTMLDivElement,
  foilFoilRow: document.getElementById('review-field-foil-row') as HTMLDivElement,
  foilSelect: document.getElementById('review-field-foil-select') as HTMLSelectElement,
  langRow: document.getElementById('review-field-lang-row') as HTMLDivElement,
  langInput: document.getElementById('review-field-lang-input') as HTMLInputElement,
  pendingLabel: document.getElementById('review-pending-label') as HTMLSpanElement,
  onItemActioned: async () => {
    await loadReviewQueue();
    await refresh();
  },
});

// ── Slide-out panel instance (scan page) ─────────────────────────────────────

const reviewPanelEl = document.getElementById('review-panel') as HTMLElement;
const scanReviewToggleBtn = document.getElementById('scan-review-toggle') as HTMLButtonElement;
const slideCloseBtn = document.getElementById('slide-close-btn') as HTMLButtonElement;

const slideOutPanel = new ReviewPanelController({
  empty: document.getElementById('slide-review-empty') as HTMLDivElement,
  content: document.getElementById('slide-review-content') as HTMLDivElement,
  snapshot: document.getElementById('slide-snapshot') as HTMLImageElement,
  reasonBadge: document.getElementById('slide-reason-badge') as HTMLDivElement,
  itemMeta: document.getElementById('slide-item-meta') as HTMLDivElement,
  toggleGallery: document.getElementById('slide-toggle-gallery') as HTMLButtonElement,
  toggleList: document.getElementById('slide-toggle-list') as HTMLButtonElement,
  gallery: document.getElementById('slide-gallery') as HTMLDivElement,
  list: document.getElementById('slide-list') as HTMLDivElement,
  listBody: document.getElementById('slide-list-body') as HTMLTableSectionElement,
  btnConfirm: document.getElementById('slide-btn-confirm') as HTMLButtonElement,
  btnSkip: document.getElementById('slide-btn-skip') as HTMLButtonElement,
  btnDismiss: document.getElementById('slide-btn-dismiss') as HTMLButtonElement,
  fieldCorrections: document.getElementById('slide-field-corrections') as HTMLDivElement,
  foilFoilRow: document.getElementById('slide-field-foil-row') as HTMLDivElement,
  foilSelect: document.getElementById('slide-field-foil-select') as HTMLSelectElement,
  langRow: document.getElementById('slide-field-lang-row') as HTMLDivElement,
  langInput: document.getElementById('slide-field-lang-input') as HTMLInputElement,
  pendingLabel: document.getElementById('slide-pending-label') as HTMLSpanElement,
});

function openSlideOut(): void {
  reviewPanelEl.hidden = false;
  scanReviewToggleBtn.classList.add('is-open');
  void slideOutPanel.loadAndRender();
}

// ── Review page: queue list + multi-select ────────────────────────────────────

function showReviewListMode(): void {
  reviewPageMode = 'list';
  reviewBackWrap.hidden = true;
  reviewQueueWrap.hidden = reviewItems.length === 0;
  document.getElementById('review-empty')!.hidden = reviewItems.length > 0;
  document.getElementById('review-panel-content')!.hidden = true;
}

function showReviewDetailMode(item: ReviewItemDto): void {
  reviewPageMode = 'detail';
  reviewBackWrap.hidden = false;
  reviewQueueWrap.hidden = true;
  document.getElementById('review-empty')!.hidden = true;
  reviewPagePanel.showItem(item);
}

function updateBulkBar(): void {
  const count = reviewSelectedIds.size;
  reviewBulkBar.hidden = count < 2;
  if (count < 2) return;

  reviewBulkCount.textContent = `${count} selected`;

  const selectedItems = reviewItems.filter((i) => reviewSelectedIds.has(i.id));
  const topSetCodes = selectedItems.map((i) => i.candidates[0]?.setCode).filter(Boolean) as string[];
  const allSameSet =
    topSetCodes.length === selectedItems.length &&
    topSetCodes.length > 0 &&
    topSetCodes.every((s) => s === topSetCodes[0]);

  if (allSameSet && topSetCodes[0]) {
    reviewBulkSetBtn.disabled = false;
    reviewBulkSetBtn.textContent = `Mark all as ${topSetCodes[0].toUpperCase()}`;
    reviewBulkSetBtn.dataset['setCode'] = topSetCodes[0];
  } else {
    reviewBulkSetBtn.disabled = true;
    reviewBulkSetBtn.textContent = 'Mark all as set —';
    delete reviewBulkSetBtn.dataset['setCode'];
  }
}

function renderQueueRow(item: ReviewItemDto, idx: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.dataset['reviewId'] = String(item.id);
  tr.dataset['idx'] = String(idx);

  const tdCheck = document.createElement('td');
  tdCheck.className = 'rq-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = reviewSelectedIds.has(item.id);
  cb.addEventListener('click', (e) => {
    e.stopPropagation();
    handleCheckboxClick(item.id, idx, e.shiftKey);
  });
  tdCheck.appendChild(cb);
  tr.appendChild(tdCheck);

  const tdThumb = document.createElement('td');
  tdThumb.className = 'rq-thumb';
  if (item.thumbnailPath) {
    const img = document.createElement('img');
    img.src = `file://${item.thumbnailPath}`;
    img.alt = '';
    img.className = 'rq-thumb-img';
    tdThumb.appendChild(img);
  }
  tr.appendChild(tdThumb);

  const tdReason = document.createElement('td');
  tdReason.className = 'rq-reason';
  const badge = document.createElement('span');
  badge.className = `review-reason-badge reason-${item.reason}`;
  badge.textContent = reasonLabel(item.reason);
  tdReason.appendChild(badge);
  tr.appendChild(tdReason);

  const tdMatch = document.createElement('td');
  tdMatch.className = 'rq-match';
  const top = item.candidates[0];
  if (top) {
    tdMatch.textContent = `${top.name} (${top.setCode.toUpperCase()} #${top.collectorNumber})`;
  } else {
    tdMatch.textContent = '—';
  }
  tr.appendChild(tdMatch);

  const tdCount = document.createElement('td');
  tdCount.className = 'rq-count';
  tdCount.textContent = String(item.candidates.length);
  tr.appendChild(tdCount);

  const tdTime = document.createElement('td');
  tdTime.className = 'rq-time';
  tdTime.textContent = new Date(item.capturedAt).toLocaleString();
  tr.appendChild(tdTime);

  const tdAction = document.createElement('td');
  tdAction.className = 'rq-action';
  const reviewBtn = document.createElement('button');
  reviewBtn.className = 'review-btn review-btn--secondary rq-review-btn';
  reviewBtn.textContent = 'Review';
  reviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showReviewDetailMode(item);
  });
  tdAction.appendChild(reviewBtn);
  tr.appendChild(tdAction);

  tr.addEventListener('click', () => {
    showReviewDetailMode(item);
  });

  return tr;
}

function renderQueueList(): void {
  reviewQueueBody.innerHTML = '';
  reviewItems.forEach((item, idx) => {
    reviewQueueBody.appendChild(renderQueueRow(item, idx));
  });
  updateSelectAllState();
}

function updateSelectAllState(): void {
  const allChecked = reviewItems.length > 0 && reviewItems.every((i) => reviewSelectedIds.has(i.id));
  reviewSelectAll.checked = allChecked;
  reviewSelectAll.indeterminate = !allChecked && reviewSelectedIds.size > 0;
}

function handleCheckboxClick(itemId: number, idx: number, shiftKey: boolean): void {
  if (shiftKey && reviewLastClickedIdx >= 0) {
    const lo = Math.min(reviewLastClickedIdx, idx);
    const hi = Math.max(reviewLastClickedIdx, idx);
    const shouldSelect = !reviewSelectedIds.has(itemId);
    for (let i = lo; i <= hi; i++) {
      const id = reviewItems[i]?.id;
      if (id != null) {
        if (shouldSelect) reviewSelectedIds.add(id);
        else reviewSelectedIds.delete(id);
      }
    }
  } else {
    if (reviewSelectedIds.has(itemId)) reviewSelectedIds.delete(itemId);
    else reviewSelectedIds.add(itemId);
    reviewLastClickedIdx = idx;
  }
  renderQueueList();
  updateBulkBar();
}

async function loadReviewQueue(): Promise<void> {
  const countRes = await window.mimir.reviewCount();
  if (countRes.ok) {
    applyReviewCount(countRes.count);
    const pendingLabel = document.getElementById('review-pending-label');
    if (pendingLabel) {
      pendingLabel.textContent =
        countRes.count > 0 ? `${countRes.count} pending` : 'No items pending';
    }
  }

  const res = await window.mimir.reviewListAll();
  reviewItems = res.ok ? res.items : [];
  reviewSelectedIds = new Set();
  reviewLastClickedIdx = -1;
  reviewBulkBar.hidden = true;

  renderQueueList();
  showReviewListMode();
}

reviewSelectAll.addEventListener('change', () => {
  if (reviewSelectAll.checked) {
    reviewItems.forEach((i) => reviewSelectedIds.add(i.id));
  } else {
    reviewSelectedIds.clear();
  }
  renderQueueList();
  updateBulkBar();
});

reviewBackBtn.addEventListener('click', () => {
  void loadReviewQueue();
});

reviewBulkFoilBtn.addEventListener('click', async () => {
  const ids = [...reviewSelectedIds];
  if (ids.length === 0) return;
  reviewBulkFoilBtn.disabled = true;
  const res = await window.mimir.reviewBulkConfirmFoil({ reviewIds: ids });
  reviewBulkFoilBtn.disabled = false;
  if (res.ok) {
    await loadReviewQueue();
    await refresh();
  }
});

reviewBulkSetBtn.addEventListener('click', async () => {
  const ids = [...reviewSelectedIds];
  const setCode = reviewBulkSetBtn.dataset['setCode'];
  if (ids.length === 0 || !setCode) return;
  reviewBulkSetBtn.disabled = true;
  const res = await window.mimir.reviewBulkConfirmSet({ reviewIds: ids, setCode });
  if (!res.ok) reviewBulkSetBtn.disabled = false;
  if (res.ok) {
    await loadReviewQueue();
    await refresh();
  }
});

reviewBulkDismissAllBtn.addEventListener('click', async () => {
  const ids = [...reviewSelectedIds];
  if (ids.length === 0) return;
  reviewBulkDismissAllBtn.disabled = true;
  const res = await window.mimir.reviewBulkDismiss({ reviewIds: ids });
  reviewBulkDismissAllBtn.disabled = false;
  if (res.ok) {
    await loadReviewQueue();
  }
});

function closeSlideOut(): void {
  reviewPanelEl.hidden = true;
  scanReviewToggleBtn.classList.remove('is-open');
}

function toggleSlideOut(): void {
  if (reviewPanelEl.hidden) openSlideOut();
  else closeSlideOut();
}

scanReviewToggleBtn.addEventListener('click', toggleSlideOut);
slideCloseBtn.addEventListener('click', closeSlideOut);

// ── Shared helpers ────────────────────────────────────────────────────────────

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

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'ambiguous_identity': return 'Ambiguous match';
    case 'unknown_card': return 'Unknown card';
    case 'manual_flagged': return 'Flagged for review';
    case 'low_confidence_field': return 'Confirm field(s)';
    default: return reason;
  }
}

function applyReviewCount(count: number): void {
  reviewCountEl.textContent = String(count);
  scanReviewCountEl.textContent = String(count);
  if (count > 0) {
    reviewCountEl.classList.add('has-items');
    scanReviewCountEl.classList.add('has-items');
  } else {
    reviewCountEl.classList.remove('has-items');
    scanReviewCountEl.classList.remove('has-items');
  }
}

// ── Catalogue ─────────────────────────────────────────────────────────────────

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
    return;
  }
  tableBody.innerHTML = '';
  for (const card of cards) {
    const tr = renderRow(card);
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCardContextMenu(card.id, e.clientX, e.clientY);
    });
    tableBody.appendChild(tr);
  }
}

let allCards: CardForRenderer[] = [];
let activeCollectionId: number | 'all' = 'all';

function applyCollectionFilter(): void {
  const filtered = activeCollectionId === 'all'
    ? allCards
    : allCards.filter((c) => c.collection_id === activeCollectionId);
  renderCards(filtered);
}

async function refresh(): Promise<void> {
  const res = await window.mimir.listCards();
  if (!res.ok) {
    setStatus(`Failed to load catalogue: ${res.error}`, 'error');
    return;
  }
  allCards = res.cards;
  applyCollectionFilter();
  refreshCollectionCounts();
}

// ── Collections sidebar ───────────────────────────────────────────────────────

const collectionsList = document.getElementById('collections-list') as HTMLUListElement;
const createCollectionBtn = document.getElementById('create-collection-btn') as HTMLButtonElement;

const collectionContextMenu = document.getElementById('collection-context-menu') as HTMLDivElement;
const ctxRenameCollectionBtn = document.getElementById('ctx-rename-collection') as HTMLButtonElement;
const ctxDeleteCollectionBtn = document.getElementById('ctx-delete-collection') as HTMLButtonElement;

const cardContextMenu = document.getElementById('card-context-menu') as HTMLDivElement;
const ctxMoveToCollectionBtn = document.getElementById('ctx-move-to-collection') as HTMLButtonElement;

const moveCollectionDialog = document.getElementById('move-collection-dialog') as HTMLDivElement;
const moveCollectionList = document.getElementById('move-collection-list') as HTMLUListElement;
const moveCollectionCancelBtn = document.getElementById('move-collection-cancel') as HTMLButtonElement;

const deleteCollectionDialog = document.getElementById('delete-collection-dialog') as HTMLDivElement;
const deleteCollectionMessage = document.getElementById('delete-collection-message') as HTMLParagraphElement;
const deleteMoveCardsBtn = document.getElementById('delete-move-cards-btn') as HTMLButtonElement;
const deleteCardsBtn = document.getElementById('delete-cards-btn') as HTMLButtonElement;
const deleteCollectionCancelBtn = document.getElementById('delete-collection-cancel') as HTMLButtonElement;

let collectionsCache: CollectionForRenderer[] = [];
let ctxCollectionId: number | null = null;
let ctxCardId: number | null = null;

function hideAllContextMenus(): void {
  collectionContextMenu.hidden = true;
  cardContextMenu.hidden = true;
}

document.addEventListener('click', hideAllContextMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideAllContextMenus(); });

function positionMenu(menu: HTMLDivElement, x: number, y: number): void {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.hidden = false;
}

function showCollectionContextMenu(id: number, x: number, y: number): void {
  ctxCollectionId = id;
  hideAllContextMenus();
  positionMenu(collectionContextMenu, x, y);
}

function showCardContextMenu(cardId: number, x: number, y: number): void {
  ctxCardId = cardId;
  hideAllContextMenus();
  positionMenu(cardContextMenu, x, y);
}

ctxRenameCollectionBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  hideAllContextMenus();
  if (ctxCollectionId == null) return;
  const col = collectionsCache.find((c) => c.id === ctxCollectionId);
  if (!col) return;
  const newName = prompt('Rename collection:', col.name);
  if (!newName || newName.trim() === col.name) return;
  const res = await window.mimir.collectionsRename({ id: ctxCollectionId, name: newName.trim() });
  if (!res.ok) { setStatus(res.error, 'error'); return; }
  await refreshCollections();
});

ctxDeleteCollectionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  hideAllContextMenus();
  if (ctxCollectionId == null) return;
  showDeleteCollectionDialog(ctxCollectionId);
});

ctxMoveToCollectionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  hideAllContextMenus();
  if (ctxCardId == null) return;
  showMoveToCollectionDialog(ctxCardId);
});

function showMoveToCollectionDialog(cardId: number): void {
  ctxCardId = cardId;
  const card = allCards.find((c) => c.id === cardId);
  moveCollectionList.innerHTML = '';
  for (const col of collectionsCache) {
    if (col.id === card?.collection_id) continue;
    const li = document.createElement('li');
    li.className = 'modal-list-item';
    const btn = document.createElement('button');
    btn.className = 'btn btn--secondary modal-list-btn';
    btn.textContent = col.name + (col.is_wishlist ? ' ★' : '');
    btn.addEventListener('click', async () => {
      moveCollectionDialog.hidden = true;
      const res = await window.mimir.cardMoveToCollection({ cardId, targetCollectionId: col.id });
      if (!res.ok) { setStatus(res.error, 'error'); return; }
      await refresh();
      await refreshCollections();
    });
    li.appendChild(btn);
    moveCollectionList.appendChild(li);
  }
  moveCollectionDialog.hidden = false;
}

moveCollectionCancelBtn.addEventListener('click', () => { moveCollectionDialog.hidden = true; });

function showDeleteCollectionDialog(id: number): void {
  ctxCollectionId = id;
  const col = collectionsCache.find((c) => c.id === id);
  if (!col) return;
  const cardCount = allCards.filter((c) => c.collection_id === id).reduce((s, c) => s + c.quantity, 0);
  if (cardCount === 0) {
    deleteCollectionMessage.textContent = `Delete "${col.name}"? This cannot be undone.`;
    deleteMoveCardsBtn.hidden = true;
  } else {
    deleteCollectionMessage.textContent = `"${col.name}" contains ${cardCount} card(s). What should happen to them?`;
    deleteMoveCardsBtn.hidden = false;
  }
  deleteCollectionDialog.hidden = false;
}

deleteMoveCardsBtn.addEventListener('click', async () => {
  deleteCollectionDialog.hidden = true;
  if (ctxCollectionId == null) return;
  const inboxId = collectionsCache.find((c) => !c.is_wishlist && c.sort_order === 0)?.id;
  const res = await window.mimir.collectionsDelete({
    id: ctxCollectionId,
    mode: 'move-cards',
    targetCollectionId: inboxId,
  });
  if (!res.ok) { setStatus(res.error, 'error'); return; }
  if (activeCollectionId === ctxCollectionId) activeCollectionId = 'all';
  await refresh();
  await refreshCollections();
});

deleteCardsBtn.addEventListener('click', async () => {
  deleteCollectionDialog.hidden = true;
  if (ctxCollectionId == null) return;
  const res = await window.mimir.collectionsDelete({ id: ctxCollectionId, mode: 'delete-cards' });
  if (!res.ok) { setStatus(res.error, 'error'); return; }
  if (activeCollectionId === ctxCollectionId) activeCollectionId = 'all';
  await refresh();
  await refreshCollections();
});

deleteCollectionCancelBtn.addEventListener('click', () => { deleteCollectionDialog.hidden = true; });

createCollectionBtn.addEventListener('click', async () => {
  const name = prompt('New collection name:');
  if (!name?.trim()) return;
  const res = await window.mimir.collectionsCreate({ name: name.trim() });
  if (!res.ok) { setStatus(res.error, 'error'); return; }
  await refreshCollections();
});

function refreshCollectionCounts(): void {
  const items = collectionsList.querySelectorAll<HTMLLIElement>('[data-collection-id]');
  for (const item of items) {
    const idStr = item.dataset['collectionId'];
    const countEl = item.querySelector<HTMLSpanElement>('.col-count');
    if (!countEl) continue;
    if (idStr === 'all') {
      const ownedTotal = allCards.reduce((s, c) => s + c.quantity, 0);
      countEl.textContent = String(ownedTotal);
    } else {
      const colId = Number(idStr);
      const count = allCards.filter((c) => c.collection_id === colId).reduce((s, c) => s + c.quantity, 0);
      countEl.textContent = String(count);
    }
  }
}

function renderCollectionItem(
  label: string,
  idStr: string | number,
  count: number,
  isWishlist: boolean,
  isActive: boolean,
): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'col-item' + (isActive ? ' is-active' : '') + (isWishlist ? ' col-item--wishlist' : '');
  li.dataset['collectionId'] = String(idStr);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'col-name';
  nameSpan.textContent = isWishlist ? `★ ${label}` : label;

  const countSpan = document.createElement('span');
  countSpan.className = 'col-count count';
  countSpan.textContent = String(count);

  li.appendChild(nameSpan);
  li.appendChild(countSpan);

  li.addEventListener('click', () => {
    activeCollectionId = idStr === 'all' ? 'all' : Number(idStr);
    setActivePage('catalogue');
    applyCollectionFilter();
    renderCollectionsSidebar();
  });

  if (idStr !== 'all') {
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCollectionContextMenu(Number(idStr), e.clientX, e.clientY);
    });
  }

  return li;
}

function renderCollectionsSidebar(): void {
  collectionsList.innerHTML = '';

  const allTotal = allCards.reduce((s, c) => s + c.quantity, 0);
  collectionsList.appendChild(
    renderCollectionItem('All', 'all', allTotal, false, activeCollectionId === 'all'),
  );

  for (const col of collectionsCache) {
    const count = allCards.filter((c) => c.collection_id === col.id).reduce((s, c) => s + c.quantity, 0);
    const isActive = activeCollectionId === col.id;
    collectionsList.appendChild(renderCollectionItem(col.name, col.id, count, col.is_wishlist, isActive));
  }
}

async function refreshCollections(): Promise<void> {
  const res = await window.mimir.collectionsList();
  if (!res.ok) return;
  collectionsCache = res.collections;
  renderCollectionsSidebar();
  populatePresetCollectionDropdown(collectionsCache);
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

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

// ── Bootstrap / first-run wizard ──────────────────────────────────────────────

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

function downloadDetail(s: BootstrapStatusDto): string {
  if (s.phase === 'ingesting' && s.totalCards) {
    return `${s.ingestedCards.toLocaleString()} / ${s.totalCards.toLocaleString()} cards`;
  }
  if (s.phase === 'downloading' && s.totalBytes) {
    return `${formatBytes(s.downloadedBytes)} / ${formatBytes(s.totalBytes)}`;
  }
  return '';
}

function progressPercent(s: BootstrapStatusDto): number {
  if (s.phase === 'done') return 100;
  if (s.phase === 'ingesting' && s.totalCards) {
    return Math.min(100, Math.round((s.ingestedCards / s.totalCards) * 100));
  }
  if (s.phase === 'downloading') {
    if (s.totalBytes && s.downloadedBytes > 0) {
      return Math.min(80, Math.round((s.downloadedBytes / s.totalBytes) * 80));
    }
    return 5;
  }
  if (s.phase === 'fetching-manifest') return 2;
  return 0;
}

function applyStatusToBanner(s: BootstrapStatusDto): void {
  const showBanner =
    !wizardOverlay.hidden ? false : s.phase !== 'idle' && s.phase !== 'done';
  bannerEl.hidden = !showBanner;
  bannerPhase.textContent = phaseLabel(s.phase);
  bannerDetail.textContent = downloadDetail(s);
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
    wizardErrorMessage.textContent = s.error || 'Unknown error';
    return;
  }
  wizardOptions.hidden = true;
  wizardError.hidden = true;
  wizardProgress.hidden = false;
  wizardPhaseLabel.textContent = phaseLabel(s.phase);
  wizardProgressCount.textContent = downloadDetail(s);
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

// ── Manage Sets page ──────────────────────────────────────────────────────────

const setsBody = document.getElementById('sets-body') as HTMLTableSectionElement;
const setsSummary = document.getElementById('sets-summary') as HTMLDivElement;
const setsCountBadge = document.getElementById('sets-count') as HTMLSpanElement;
const navItems = Array.from(
  document.querySelectorAll<HTMLLIElement>('#sidebar .sidebar-nav-list .nav-item'),
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
    closeSlideOut();
  }

  if (page === 'sets') {
    void refreshSets();
  } else if (page === 'scan') {
    void enterScanPage();
  } else if (page === 'review') {
    void loadReviewQueue();
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
  if (event.status === 'complete' || event.status === 'none' || event.status === 'error') {
    void refreshSets();
  } else {
    const row = setsBody.querySelector<HTMLTableRowElement>(`tr[data-set-code="${event.setCode}"]`);
    const set = setsCache.find((s) => s.code === event.setCode);
    if (row && set) {
      row.replaceWith(renderSetRow(set));
    }
  }
});

// ── Initialisation ────────────────────────────────────────────────────────────

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
  await refreshCollections();
  await refresh();
  await refreshSets();
  const countRes = await window.mimir.reviewCount();
  if (countRes.ok) applyReviewCount(countRes.count);
})();

// ── Scan page ─────────────────────────────────────────────────────────────────

const scanVideo = document.getElementById('scan-video') as HTMLVideoElement;
const scanOverlay = document.getElementById('scan-overlay') as HTMLCanvasElement;
const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
const scanErrorEl = document.getElementById('scan-error') as HTMLDivElement;
const scanErrorMessage = document.getElementById('scan-error-message') as HTMLSpanElement;
const scanRetryBtn = document.getElementById('scan-retry-btn') as HTMLButtonElement;
const scanPermissionPrompt = document.getElementById('scan-permission-prompt') as HTMLDivElement;
const scanRequestPermissionBtn = document.getElementById('scan-request-permission-btn') as HTMLButtonElement;
const scanRecentsStrip = document.getElementById('scan-recents-strip') as HTMLDivElement;
const scanQueueBar = document.getElementById('scan-queue-bar') as HTMLDivElement;
const scanQueueDepthEl = document.getElementById('scan-queue-depth') as HTMLSpanElement;
const scanQueueEtaEl = document.getElementById('scan-queue-eta') as HTMLSpanElement;
const scanQueueFill = document.getElementById('scan-queue-fill') as HTMLDivElement;

// ── Scan preset bar ───────────────────────────────────────────────────────────

const presetFoilSelect = document.getElementById('preset-foil') as HTMLSelectElement;
const presetConditionSelect = document.getElementById('preset-condition') as HTMLSelectElement;
const presetLanguageSelect = document.getElementById('preset-language') as HTMLSelectElement;
const presetCollectionSelect = document.getElementById('preset-collection') as HTMLSelectElement;

function currentPreset(): ScanModePreset {
  const collVal = presetCollectionSelect.value;
  return {
    foil: presetFoilSelect.value as ScanModePreset['foil'],
    condition: presetConditionSelect.value as ScanModePreset['condition'],
    language: presetLanguageSelect.value as ScanModePreset['language'],
    collectionId: collVal === 'inbox' ? 'inbox' : Number(collVal),
  };
}

function updatePresetHighlights(): void {
  presetFoilSelect.classList.toggle('is-active', presetFoilSelect.value !== 'auto');
  presetLanguageSelect.classList.toggle('is-active', presetLanguageSelect.value !== 'auto');
  presetConditionSelect.classList.toggle('is-active', presetConditionSelect.value !== 'NM');
  presetCollectionSelect.classList.toggle('is-active', presetCollectionSelect.value !== 'inbox');
}

presetFoilSelect.addEventListener('change', updatePresetHighlights);
presetConditionSelect.addEventListener('change', updatePresetHighlights);
presetLanguageSelect.addEventListener('change', updatePresetHighlights);
presetCollectionSelect.addEventListener('change', updatePresetHighlights);

function populatePresetCollectionDropdown(collections: CollectionForRenderer[]): void {
  const current = presetCollectionSelect.value;
  presetCollectionSelect.innerHTML = '<option value="inbox">Inbox</option>';
  for (const col of collections) {
    if (col.is_wishlist) continue;
    const opt = document.createElement('option');
    opt.value = String(col.id);
    opt.textContent = col.name;
    if (String(col.id) === current) opt.selected = true;
    presetCollectionSelect.appendChild(opt);
  }
}

let activeStream: MediaStream | null = null;
let detectorState: DetectorState = initState();
let rafHandle: number | null = null;
let lastFrameMs = 0;

const frameCanvas = document.createElement('canvas');
const frameCtx = frameCanvas.getContext('2d')!;

function stopCamera(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  detectorState = initState();
  lastFrameMs = 0;

  if (activeStream) {
    for (const track of activeStream.getTracks()) track.stop();
    activeStream = null;
  }
  scanVideo.srcObject = null;
  clearOverlay();
}

function clearOverlay(): void {
  const ctx = scanOverlay.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, scanOverlay.width, scanOverlay.height);
}

function drawOverlay(
  quad: import('./card-detector.js').Quad | null,
  phase: DetectorState['phase'],
): void {
  // Use the canvas's CSS-rendered size as the drawing buffer so coordinates
  // match the container exactly (avoids browser up/down-scaling artifacts).
  const CW = scanOverlay.clientWidth;
  const CH = scanOverlay.clientHeight;
  if (CW === 0 || CH === 0) return;

  scanOverlay.width = CW;
  scanOverlay.height = CH;

  const ctx = scanOverlay.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, CW, CH);

  if (!quad || phase === 'idle') return;

  // Map video-space coordinates to canvas-space, accounting for the
  // object-fit:contain letterbox/pillarbox the browser adds to the video element.
  const VW = scanVideo.videoWidth || CW;
  const VH = scanVideo.videoHeight || CH;
  const scale = Math.min(CW / VW, CH / VH);
  const ox = (CW - VW * scale) / 2;
  const oy = (CH - VH * scale) / 2;
  const tx = (vx: number): number => ox + vx * scale;
  const ty = (vy: number): number => oy + vy * scale;

  const [q0, q1, q2, q3] = quad;
  ctx.beginPath();
  ctx.moveTo(tx(q0.x), ty(q0.y));
  ctx.lineTo(tx(q1.x), ty(q1.y));
  ctx.lineTo(tx(q2.x), ty(q2.y));
  ctx.lineTo(tx(q3.x), ty(q3.y));
  ctx.closePath();

  ctx.strokeStyle = phase === 'cooldown' ? '#00FF00' : '#FFD700';
  ctx.lineWidth = Math.max(2, CW * 0.004);
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

async function fireCapture(
  pixels: Uint8ClampedArray,
  W: number,
  H: number,
  quad: import('./card-detector.js').Quad,
): Promise<void> {
  const warped = warpCard(pixels, W, H, quad);
  const wW = 400, wH = 559;

  const warpCanvas = document.createElement('canvas');
  warpCanvas.width = wW;
  warpCanvas.height = wH;
  const wCtx = warpCanvas.getContext('2d');
  if (!wCtx) return;

  const imageData = wCtx.createImageData(wW, wH);
  imageData.data.set(warped);
  wCtx.putImageData(imageData, 0, 0);
  const dataUrl = warpCanvas.toDataURL('image/jpeg', 0.85);

  try {
    const res = await window.mimir.scansCapture({ dataUrl, preset: currentPreset() });
    if (res.ok) {
      await loadRecentScans();
    }
  } catch {
    // Capture errors are silent — detection continues
  }
}

function runDetectionLoop(nowMs: number): void {
  rafHandle = requestAnimationFrame(runDetectionLoop);

  if (!activeStream || scanVideo.readyState < 2) return;

  const W = scanVideo.videoWidth;
  const H = scanVideo.videoHeight;
  if (W === 0 || H === 0) return;

  frameCanvas.width = W;
  frameCanvas.height = H;
  frameCtx.drawImage(scanVideo, 0, 0, W, H);
  const pixels = frameCtx.getImageData(0, 0, W, H).data as Uint8ClampedArray;

  const quad = detectCard(pixels, W, H);

  const deltaMs = lastFrameMs === 0 ? 16 : nowMs - lastFrameMs;
  lastFrameMs = nowMs;

  const { state, events } = step(detectorState, { quad, deltaMs });
  detectorState = state;

  drawOverlay(quad, state.phase);

  for (const ev of events) {
    void fireCapture(pixels, W, H, ev.quad);
  }
}

function showScanError(msg: string): void {
  scanErrorMessage.textContent = msg;
  scanErrorEl.hidden = false;
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
        stopCamera();
      };
    }

    await populateCameraList();
    const currentId = track?.getSettings().deviceId ?? '';
    if (currentId) {
      cameraSelect.value = currentId;
      void window.mimir.settingsSet({ key: 'preferredCameraId', value: currentId });
    }

    rafHandle = requestAnimationFrame(runDetectionLoop);
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

scanRetryBtn.addEventListener('click', () => {
  const deviceId = cameraSelect.value || undefined;
  void startCamera(deviceId);
});

scanRequestPermissionBtn.addEventListener('click', () => {
  void startCamera(undefined);
});

let queueHighWater = 0;

function applyScanQueueDepth(event: ScanQueueDepthDto): void {
  const { depth, etaMs } = event;
  if (depth > queueHighWater) queueHighWater = depth;
  if (depth === 0) {
    scanQueueBar.hidden = true;
    queueHighWater = 0;
    scanQueueFill.style.width = '0%';
    return;
  }
  scanQueueBar.hidden = false;
  scanQueueDepthEl.textContent = String(depth);
  scanQueueEtaEl.textContent = etaMs != null ? `~${Math.ceil(etaMs / 1000)}s` : '';
  const pct = queueHighWater > 0 ? Math.round(((queueHighWater - depth) / queueHighWater) * 100) : 0;
  scanQueueFill.style.width = `${pct}%`;
}

window.mimir.onScanQueueDepth(applyScanQueueDepth);

// ── Global keyboard shortcuts ─────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  // Scan page: R toggles the slide-out panel
  if (currentPage === 'scan' && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    toggleSlideOut();
    return;
  }

  // Escape closes the slide-out without toggling
  if (currentPage === 'scan' && e.key === 'Escape' && !reviewPanelEl.hidden) {
    e.preventDefault();
    closeSlideOut();
    return;
  }

  // Review-panel keyboard shortcuts route to whichever panel is active
  const activePanel =
    currentPage === 'review'
      ? reviewPagePanel
      : currentPage === 'scan' && !reviewPanelEl.hidden
        ? slideOutPanel
        : null;

  if (!activePanel) return;

  const digit = parseInt(e.key, 10);
  if (!isNaN(digit) && digit >= 1 && digit <= 9) {
    e.preventDefault();
    activePanel.selectCandidate(digit - 1);
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    if (!activePanel.btnConfirm.disabled) activePanel.btnConfirm.click();
    return;
  }

  if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    activePanel.btnSkip.click();
    return;
  }

  if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    activePanel.btnDismiss.click();
  }
});

// ── Review pending updates ────────────────────────────────────────────────────

window.mimir.onReviewPendingUpdate((event: ReviewCountDto) => {
  applyReviewCount(event.count);
  if (currentPage === 'review') {
    if (reviewPageMode === 'list') {
      void loadReviewQueue();
    }
  } else if (currentPage === 'scan' && !reviewPanelEl.hidden) {
    void slideOutPanel.loadAndRender();
  }
});
