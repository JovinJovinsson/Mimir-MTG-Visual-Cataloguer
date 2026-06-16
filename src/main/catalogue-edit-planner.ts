import type { Foil, Condition } from '../shared/types.js';

export type SortField =
  | 'name'
  | 'set_code'
  | 'collector_number'
  | 'quantity'
  | 'foil'
  | 'condition'
  | 'price_usd'
  | 'last_seen_at';

export type SortDir = 'asc' | 'desc';

export interface SortPref {
  field: SortField;
  dir: SortDir;
}

export type SortByCollection = Record<string | number, SortPref>;

export type CatalogueEditAction =
  | { kind: 'update-qty'; cardId: number; qty: number }
  | { kind: 'update-foil'; cardId: number; foil: Foil }
  | { kind: 'update-condition'; cardId: number; condition: Condition }
  | { kind: 'update-notes'; cardId: number; notes: string | null }
  | { kind: 'update-collection'; cardId: number; collectionId: number };

export interface BulkEditInput {
  qty?: number;
  foil?: Foil;
  condition?: Condition;
  collectionId?: number;
}

export interface CardRowForEdit {
  id: number;
  quantity: number;
  collection_id: number;
}

export function planBulkEdit(
  selectedRows: CardRowForEdit[],
  edit: BulkEditInput,
): CatalogueEditAction[] {
  const actions: CatalogueEditAction[] = [];
  for (const row of selectedRows) {
    if (edit.qty != null) {
      actions.push({ kind: 'update-qty', cardId: row.id, qty: edit.qty });
    }
    if (edit.foil != null) {
      actions.push({ kind: 'update-foil', cardId: row.id, foil: edit.foil });
    }
    if (edit.condition != null) {
      actions.push({ kind: 'update-condition', cardId: row.id, condition: edit.condition });
    }
    if (edit.collectionId != null && edit.collectionId !== row.collection_id) {
      actions.push({ kind: 'update-collection', cardId: row.id, collectionId: edit.collectionId });
    }
  }
  return actions;
}

export function sortPersistenceReducer(
  current: SortByCollection,
  collectionId: string | number,
  newSort: SortPref,
): SortByCollection {
  return { ...current, [collectionId]: newSort };
}
