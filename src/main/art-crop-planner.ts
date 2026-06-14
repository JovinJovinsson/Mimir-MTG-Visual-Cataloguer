export interface SetCropCardRow {
  scryfall_id: string;
  image_art_crop_url: string | null;
  phash: string | null;
  art_crop_path: string | null;
}

export interface DownloadTarget {
  scryfall_id: string;
  image_art_crop_url: string;
}

export type SetDownloadPlan =
  | {
      kind: 'download';
      setCode: string;
      cards: DownloadTarget[];
      totalCards: number;
      alreadyHashed: number;
      skippedNoUrl: number;
    }
  | { kind: 'complete' }
  | { kind: 'empty' };

export function planSetCropDownload(
  setCode: string,
  cards: SetCropCardRow[],
): SetDownloadPlan {
  if (cards.length === 0) return { kind: 'empty' };

  const targets: DownloadTarget[] = [];
  let alreadyHashed = 0;
  let skippedNoUrl = 0;
  let hashableCards = 0;

  for (const c of cards) {
    const hashed = c.phash != null && c.art_crop_path != null;
    if (hashed) {
      alreadyHashed++;
      hashableCards++;
      continue;
    }
    if (!c.image_art_crop_url) {
      skippedNoUrl++;
      continue;
    }
    hashableCards++;
    targets.push({
      scryfall_id: c.scryfall_id,
      image_art_crop_url: c.image_art_crop_url,
    });
  }

  if (hashableCards === 0) return { kind: 'complete' };
  if (targets.length === 0) return { kind: 'complete' };

  return {
    kind: 'download',
    setCode,
    cards: targets,
    totalCards: cards.length,
    alreadyHashed,
    skippedNoUrl,
  };
}

const ESTIMATED_BYTES_PER_CROP = 30_000;

export function estimateDiskUsageBytes(cardCount: number): number {
  return cardCount * ESTIMATED_BYTES_PER_CROP;
}
