import { ipcMain } from 'electron';
import { IPC_CHANNELS, type AddCardByIdRequest, type AddCardByIdResponse, type ListCardsResponse } from '../shared/ipc.js';
import type { CatalogueDb } from './database.js';
import { fetchScryfallCardById } from './scryfall.js';
import type { CardForRenderer } from '../shared/types.js';

export function registerIpcHandlers(db: CatalogueDb): void {
  ipcMain.handle(
    IPC_CHANNELS.addCardById,
    async (_event, req: AddCardByIdRequest): Promise<AddCardByIdResponse> => {
      try {
        const card = await fetchScryfallCardById(req.scryfall_id);
        const foil = req.foil ?? (card.available_finishes.includes('normal') ? 'normal' : card.available_finishes[0]!);
        const result = db.addCard({
          scryfall_id: card.scryfall_id,
          name: card.name,
          set_code: card.set_code,
          set_name: card.set_name,
          collector_number: card.collector_number,
          foil,
          condition: req.condition ?? 'NM',
          language: req.language ?? 'EN',
          price_usd: card.price_usd,
        });
        const inserted = findCard(db, result.id);
        return { ok: true, id: result.id, created: result.created, card: inserted };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.listCards, async (): Promise<ListCardsResponse> => {
    try {
      return { ok: true, cards: db.listCards() };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
}

function findCard(db: CatalogueDb, id: number): CardForRenderer {
  const all = db.listCards();
  const card = all.find((c) => c.id === id);
  if (!card) throw new Error(`Card ${id} not found after insert/bump`);
  return card;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
