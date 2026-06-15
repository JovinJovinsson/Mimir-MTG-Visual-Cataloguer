import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AddCardByIdRequest,
  type AddCardByIdResponse,
  type AddCardByNameRequest,
  type AddCardByNameResponse,
  type AutocompleteResponse,
  type BootstrapStartRequest,
  type BootstrapStartResponse,
  type BootstrapStatusDto,
  type CaptureRequest,
  type CaptureResponse,
  type GetSettingRequest,
  type GetSettingResponse,
  type ListCardsResponse,
  type ListRecentScansResponse,
  type MimirApi,
  type ReviewBulkConfirmFoilRequest,
  type ReviewBulkConfirmFoilResponse,
  type ReviewBulkConfirmSetRequest,
  type ReviewBulkConfirmSetResponse,
  type ReviewBulkDismissRequest,
  type ReviewBulkDismissResponse,
  type ReviewConfirmRequest,
  type ReviewConfirmResponse,
  type ReviewCountDto,
  type ReviewCountResponse,
  type ReviewDismissRequest,
  type ReviewDismissResponse,
  type ReviewListAllResponse,
  type ReviewListPendingResponse,
  type ReviewSkipRequest,
  type ReviewSkipResponse,
  type ScanQueueDepthDto,
  type SetProgressDto,
  type SetSettingRequest,
  type SetSettingResponse,
  type SetsListResponse,
  type SetsToggleDownloadRequest,
  type SetsToggleDownloadResponse,
} from '../shared/ipc.js';

const api: MimirApi = {
  addCardById: (req: AddCardByIdRequest): Promise<AddCardByIdResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.addCardById, req),
  addCardByName: (req: AddCardByNameRequest): Promise<AddCardByNameResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.addCardByName, req),
  listCards: (): Promise<ListCardsResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.listCards),
  autocompleteByName: (query: string, limit?: number): Promise<AutocompleteResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.autocompleteByName, { query, limit }),
  bootstrapStatus: (): Promise<BootstrapStatusDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.bootstrapStatus),
  bootstrapStart: (req: BootstrapStartRequest): Promise<BootstrapStartResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.bootstrapStart, req),
  onBootstrapProgress: (cb: (status: BootstrapStatusDto) => void) => {
    const listener = (_event: unknown, status: BootstrapStatusDto): void => cb(status);
    ipcRenderer.on(IPC_CHANNELS.bootstrapProgress, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.bootstrapProgress, listener);
    };
  },
  setsList: (): Promise<SetsListResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.setsList),
  setsToggleDownload: (req: SetsToggleDownloadRequest): Promise<SetsToggleDownloadResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.setsToggleDownload, req),
  onSetsProgress: (cb: (event: SetProgressDto) => void) => {
    const listener = (_event: unknown, e: SetProgressDto): void => cb(e);
    ipcRenderer.on(IPC_CHANNELS.setsProgress, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.setsProgress, listener);
    };
  },
  scansCapture: (req: CaptureRequest): Promise<CaptureResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.scansCapture, req),
  scansListRecent: (limit?: number): Promise<ListRecentScansResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.scansListRecent, { limit }),
  onScanQueueDepth: (cb: (event: ScanQueueDepthDto) => void) => {
    const listener = (_event: unknown, e: ScanQueueDepthDto): void => cb(e);
    ipcRenderer.on(IPC_CHANNELS.scanQueueDepth, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.scanQueueDepth, listener);
    };
  },
  settingsGet: (req: GetSettingRequest): Promise<GetSettingResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsGet, req),
  settingsSet: (req: SetSettingRequest): Promise<SetSettingResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSet, req),
  reviewListPending: (): Promise<ReviewListPendingResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewListPending),
  reviewListAll: (): Promise<ReviewListAllResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewListAll),
  reviewCount: (): Promise<ReviewCountResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewCount),
  reviewConfirm: (req: ReviewConfirmRequest): Promise<ReviewConfirmResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewConfirm, req),
  reviewSkip: (req: ReviewSkipRequest): Promise<ReviewSkipResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewSkip, req),
  reviewDismiss: (req: ReviewDismissRequest): Promise<ReviewDismissResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewDismiss, req),
  reviewBulkDismiss: (req: ReviewBulkDismissRequest): Promise<ReviewBulkDismissResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewBulkDismiss, req),
  reviewBulkConfirmFoil: (req: ReviewBulkConfirmFoilRequest): Promise<ReviewBulkConfirmFoilResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewBulkConfirmFoil, req),
  reviewBulkConfirmSet: (req: ReviewBulkConfirmSetRequest): Promise<ReviewBulkConfirmSetResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewBulkConfirmSet, req),
  onReviewPendingUpdate: (cb: (event: ReviewCountDto) => void) => {
    const listener = (_event: unknown, e: ReviewCountDto): void => cb(e);
    ipcRenderer.on(IPC_CHANNELS.reviewPendingUpdate, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.reviewPendingUpdate, listener);
    };
  },
};

contextBridge.exposeInMainWorld('mimir', api);
