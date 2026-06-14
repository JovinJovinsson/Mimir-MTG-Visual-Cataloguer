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
  type ListCardsResponse,
  type MimirApi,
  type SetProgressDto,
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
};

contextBridge.exposeInMainWorld('mimir', api);
