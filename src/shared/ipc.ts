import type { CardForRenderer, CollectionForRenderer, Condition, Foil, ScanForRenderer, ReviewItemDto, ScanModePreset } from './types.js';

export type { ReviewItemDto };

export const IPC_CHANNELS = {
  cardUpdateField: 'cards:updateField',
  cardBulkEdit: 'cards:bulkEdit',
  cardDelete: 'cards:delete',
  cardAddToReview: 'cards:addToReview',
  openExternal: 'app:openExternal',
  exportCsv: 'catalogue:exportCsv',
  reviewConfirmFieldCorrections: 'review:confirmFieldCorrections',
  addCardById: 'catalogue:addCardById',
  addCardByName: 'catalogue:addCardByName',
  listCards: 'catalogue:listCards',
  autocompleteByName: 'catalogue:autocompleteByName',
  collectionsList: 'collections:list',
  collectionsCreate: 'collections:create',
  collectionsRename: 'collections:rename',
  collectionsDelete: 'collections:delete',
  cardMoveToCollection: 'cards:moveToCollection',
  bootstrapStatus: 'bootstrap:status',
  bootstrapStart: 'bootstrap:start',
  bootstrapProgress: 'bootstrap:progress',
  setsList: 'sets:list',
  setsToggleDownload: 'sets:toggleDownload',
  setsProgress: 'sets:progress',
  scansCapture: 'scans:capture',
  scansListRecent: 'scans:listRecent',
  scanQueueDepth: 'scan:queueDepth',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  reviewListPending: 'review:listPending',
  reviewListAll: 'review:listAll',
  reviewCount: 'review:count',
  reviewConfirm: 'review:confirm',
  reviewSkip: 'review:skip',
  reviewDismiss: 'review:dismiss',
  reviewBulkDismiss: 'review:bulkDismiss',
  reviewBulkConfirmFoil: 'review:bulkConfirmFoil',
  reviewBulkConfirmSet: 'review:bulkConfirmSet',
  reviewPendingUpdate: 'review:pendingUpdate',
  scryfallCheckUpdate: 'scryfall:checkUpdate',
  scryfallRefresh: 'scryfall:refresh',
  scryfallUpdateAvailable: 'scryfall:updateAvailable',
  backupExport: 'backup:export',
  backupRestore: 'backup:restore',
  backupAutoRun: 'backup:autoRun',
  backupChooseFolder: 'backup:chooseFolder',
  setsListForWizard: 'sets:listForWizard',
  reviewSaveWithoutSet: 'review:saveWithoutSet',
} as const;

export type ExportFormat = 'moxfield' | 'deckbox' | 'manabox' | 'mimir-native';
export type ExportScope = 'all' | 'collection';

export interface ExportCsvRequest {
  format: ExportFormat;
  scope: ExportScope;
  collectionId?: number;
}

export type ExportCsvResponse =
  | { ok: true; savedPath: string | null }
  | { ok: false; error: string };

export interface AddCardByIdRequest {
  scryfall_id: string;
  foil?: Foil;
  condition?: Condition;
  language?: string;
}

export type AddCardByIdResponse =
  | { ok: true; id: number; created: boolean; card: CardForRenderer }
  | { ok: false; error: string };

export interface AddCardByNameRequest {
  scryfall_id: string;
  foil?: Foil;
  condition?: Condition;
  language?: string;
}

export type AddCardByNameResponse = AddCardByIdResponse;

export type ListCardsResponse =
  | { ok: true; cards: CardForRenderer[] }
  | { ok: false; error: string };

export type CollectionsListResponse =
  | { ok: true; collections: CollectionForRenderer[] }
  | { ok: false; error: string };

export interface CollectionsCreateRequest {
  name: string;
}

export type CollectionsCreateResponse =
  | { ok: true; id: number }
  | { ok: false; error: string };

export interface CollectionsRenameRequest {
  id: number;
  name: string;
}

export type CollectionsRenameResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface CollectionsDeleteRequest {
  id: number;
  mode: 'delete-cards' | 'move-cards';
  targetCollectionId?: number;
}

export type CollectionsDeleteResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface CardMoveToCollectionRequest {
  cardId: number;
  targetCollectionId: number;
}

export type CardMoveToCollectionResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface AutocompleteHitDto {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
}

export type AutocompleteResponse =
  | { ok: true; hits: AutocompleteHitDto[] }
  | { ok: false; error: string };

export type BootstrapPhase =
  | 'idle'
  | 'fetching-manifest'
  | 'downloading'
  | 'ingesting'
  | 'done'
  | 'error';

export interface BootstrapStatusDto {
  phase: BootstrapPhase;
  cardCount: number;
  setCount: number;
  scannerGateOpen: boolean;
  totalBytes: number | null;
  downloadedBytes: number;
  ingestedCards: number;
  totalCards: number | null;
  error: string | null;
  updatedAt: number;
}

export type BootstrapStartRequest =
  | { selection: 'full' }
  | { selection: 'selected'; setCodes: string[] }
  | { selection: 'standard' };
export type BootstrapStartResponse = { ok: true } | { ok: false; error: string };

export type SetDownloadStatus = 'none' | 'downloading' | 'complete' | 'error';

export interface SetWithStatusDto {
  code: string;
  name: string;
  card_count: number;
  hashed_count: number;
  download_status: SetDownloadStatus;
  is_downloaded: number;
  estimated_disk_bytes: number;
}

export type SetsListResponse =
  | { ok: true; sets: SetWithStatusDto[] }
  | { ok: false; error: string };

export interface SetsToggleDownloadRequest {
  setCode: string;
  enabled: boolean;
}

export type SetsToggleDownloadResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface SetProgressDto {
  setCode: string;
  downloaded: number;
  failed: number;
  total: number;
  status: SetDownloadStatus;
}

export interface CaptureRequest {
  dataUrl: string;
  preset?: ScanModePreset;
}

export type CaptureResponse =
  | { ok: true; scan: ScanForRenderer }
  | { ok: false; error: string };

export type ListRecentScansResponse =
  | { ok: true; scans: ScanForRenderer[] }
  | { ok: false; error: string };

export interface ScanQueueDepthDto {
  depth: number;
  etaMs: number | null;
}

export interface GetSettingRequest {
  key: string;
}

export type GetSettingResponse =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export interface SetSettingRequest {
  key: string;
  value: string;
}

export type SetSettingResponse =
  | { ok: true }
  | { ok: false; error: string };

export type ReviewListPendingResponse =
  | { ok: true; items: ReviewItemDto[] }
  | { ok: false; error: string };

export interface ReviewCountDto {
  count: number;
}

export type ReviewCountResponse =
  | { ok: true; count: number }
  | { ok: false; error: string };

export interface ReviewConfirmRequest {
  reviewId: number;
  scryfallId: string;
}

export type ReviewConfirmResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface ReviewSkipRequest {
  reviewId: number;
}

export type ReviewSkipResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface ReviewDismissRequest {
  reviewId: number;
}

export type ReviewDismissResponse =
  | { ok: true }
  | { ok: false; error: string };

export type ReviewListAllResponse =
  | { ok: true; items: ReviewItemDto[] }
  | { ok: false; error: string };

export interface ReviewBulkDismissRequest {
  reviewIds: number[];
}

export type ReviewBulkDismissResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface ReviewBulkConfirmFoilRequest {
  reviewIds: number[];
}

export type ReviewBulkConfirmFoilResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface ReviewBulkConfirmSetRequest {
  reviewIds: number[];
  setCode: string;
}

export type ReviewBulkConfirmSetResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface ReviewConfirmFieldCorrectionsRequest {
  reviewId: number;
  cardId: number;
  foil: Foil;
  language: string;
}

export type ReviewConfirmFieldCorrectionsResponse =
  | { ok: true }
  | { ok: false; error: string };

export type ScryfallUpdateCheckResult = 'needs-refresh' | 'current';

export type ScryfallCheckUpdateResponse =
  | { ok: true; result: ScryfallUpdateCheckResult; remoteUpdatedAt: string }
  | { ok: false; error: string };

export type ScryfallRefreshResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface ScryfallUpdateAvailableDto {
  remoteUpdatedAt: string;
}

export interface ScryfallSetForWizard {
  code: string;
  name: string;
  card_count: number;
  released_at: string | null;
  download_status: string;
  is_downloaded: number;
}

export type SetsListForWizardResponse =
  | { ok: true; sets: ScryfallSetForWizard[] }
  | { ok: false; error: string };

export interface ReviewSaveWithoutSetRequest {
  reviewId: number;
  scryfallId: string;
}

export type ReviewSaveWithoutSetResponse =
  | { ok: true }
  | { ok: false; error: string };

export type BackupChooseFolderResponse =
  | { ok: true; cancelled?: false; folder: string }
  | { ok: true; cancelled: true; folder?: undefined }
  | { ok: false; error: string };

export type BackupExportResponse =
  | { ok: true; savedPath: string | null }
  | { ok: false; error: string };

export type BackupRestoreResponse =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type BackupAutoRunResponse =
  | { ok: true; savedPath: string }
  | { ok: false; error: string };

export interface CardUpdateFieldRequest {
  cardId: number;
  field: 'quantity' | 'foil' | 'condition' | 'notes';
  value: number | string | null;
}

export type CardUpdateFieldResponse =
  | { ok: true; card: CardForRenderer }
  | { ok: false; error: string };

export interface CardBulkEditRequest {
  cardIds: number[];
  qty?: number;
  foil?: Foil;
  condition?: Condition;
  collectionId?: number;
}

export type CardBulkEditResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface CardDeleteRequest {
  cardId: number;
}

export type CardDeleteResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface CardAddToReviewRequest {
  cardId: number;
}

export type CardAddToReviewResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface OpenExternalRequest {
  url: string;
}

export type OpenExternalResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface MimirApi {
  exportCsv(req: ExportCsvRequest): Promise<ExportCsvResponse>;
  reviewConfirmFieldCorrections(req: ReviewConfirmFieldCorrectionsRequest): Promise<ReviewConfirmFieldCorrectionsResponse>;
  addCardById(req: AddCardByIdRequest): Promise<AddCardByIdResponse>;
  addCardByName(req: AddCardByNameRequest): Promise<AddCardByNameResponse>;
  listCards(): Promise<ListCardsResponse>;
  autocompleteByName(query: string, limit?: number): Promise<AutocompleteResponse>;
  collectionsList(): Promise<CollectionsListResponse>;
  collectionsCreate(req: CollectionsCreateRequest): Promise<CollectionsCreateResponse>;
  collectionsRename(req: CollectionsRenameRequest): Promise<CollectionsRenameResponse>;
  collectionsDelete(req: CollectionsDeleteRequest): Promise<CollectionsDeleteResponse>;
  cardMoveToCollection(req: CardMoveToCollectionRequest): Promise<CardMoveToCollectionResponse>;
  bootstrapStatus(): Promise<BootstrapStatusDto>;
  bootstrapStart(req: BootstrapStartRequest): Promise<BootstrapStartResponse>;
  onBootstrapProgress(cb: (status: BootstrapStatusDto) => void): () => void;
  setsList(): Promise<SetsListResponse>;
  setsToggleDownload(req: SetsToggleDownloadRequest): Promise<SetsToggleDownloadResponse>;
  onSetsProgress(cb: (event: SetProgressDto) => void): () => void;
  scansCapture(req: CaptureRequest): Promise<CaptureResponse>;
  scansListRecent(limit?: number): Promise<ListRecentScansResponse>;
  onScanQueueDepth(cb: (event: ScanQueueDepthDto) => void): () => void;
  settingsGet(req: GetSettingRequest): Promise<GetSettingResponse>;
  settingsSet(req: SetSettingRequest): Promise<SetSettingResponse>;
  reviewListPending(): Promise<ReviewListPendingResponse>;
  reviewListAll(): Promise<ReviewListAllResponse>;
  reviewCount(): Promise<ReviewCountResponse>;
  reviewConfirm(req: ReviewConfirmRequest): Promise<ReviewConfirmResponse>;
  reviewSkip(req: ReviewSkipRequest): Promise<ReviewSkipResponse>;
  reviewDismiss(req: ReviewDismissRequest): Promise<ReviewDismissResponse>;
  reviewBulkDismiss(req: ReviewBulkDismissRequest): Promise<ReviewBulkDismissResponse>;
  reviewBulkConfirmFoil(req: ReviewBulkConfirmFoilRequest): Promise<ReviewBulkConfirmFoilResponse>;
  reviewBulkConfirmSet(req: ReviewBulkConfirmSetRequest): Promise<ReviewBulkConfirmSetResponse>;
  onReviewPendingUpdate(cb: (event: ReviewCountDto) => void): () => void;
  scryfallCheckUpdate(): Promise<ScryfallCheckUpdateResponse>;
  scryfallRefresh(): Promise<ScryfallRefreshResponse>;
  onScryfallUpdateAvailable(cb: (event: ScryfallUpdateAvailableDto) => void): () => void;
  backupChooseFolder(): Promise<BackupChooseFolderResponse>;
  backupExport(): Promise<BackupExportResponse>;
  backupRestore(): Promise<BackupRestoreResponse>;
  backupAutoRun(): Promise<BackupAutoRunResponse>;
  cardUpdateField(req: CardUpdateFieldRequest): Promise<CardUpdateFieldResponse>;
  cardBulkEdit(req: CardBulkEditRequest): Promise<CardBulkEditResponse>;
  cardDelete(req: CardDeleteRequest): Promise<CardDeleteResponse>;
  cardAddToReview(req: CardAddToReviewRequest): Promise<CardAddToReviewResponse>;
  openExternal(req: OpenExternalRequest): Promise<OpenExternalResponse>;
  setsListForWizard(): Promise<SetsListForWizardResponse>;
  reviewSaveWithoutSet(req: ReviewSaveWithoutSetRequest): Promise<ReviewSaveWithoutSetResponse>;
}

declare global {
  interface Window {
    mimir: MimirApi;
  }
}
