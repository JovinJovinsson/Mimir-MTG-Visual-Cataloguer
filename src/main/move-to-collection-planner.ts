import type { CardsRow, CatalogueAction } from '../shared/types.js';

export function planMoveToCollection(
  sourceRow: CardsRow,
  destinationCollectionId: number,
  existingRowInDestination: CardsRow | null,
): CatalogueAction[] {
  if (sourceRow.collection_id === destinationCollectionId) return [];

  if (existingRowInDestination) {
    return [
      {
        kind: 'bump',
        cardId: existingRowInDestination.id,
        newQuantity: existingRowInDestination.quantity + sourceRow.quantity,
        lastSeenAt: Math.max(existingRowInDestination.last_seen_at, sourceRow.last_seen_at),
      },
      {
        kind: 'delete-card',
        cardId: sourceRow.id,
      },
    ];
  }

  return [
    {
      kind: 'update-collection',
      cardId: sourceRow.id,
      collectionId: destinationCollectionId,
    },
  ];
}
