import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AddCardByIdRequest, type AddCardByIdResponse, type ListCardsResponse, type MimirApi } from '../shared/ipc.js';

const api: MimirApi = {
  addCardById: (req: AddCardByIdRequest): Promise<AddCardByIdResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.addCardById, req),
  listCards: (): Promise<ListCardsResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.listCards),
};

contextBridge.exposeInMainWorld('mimir', api);
