import { describe, it, expect, vi } from 'vitest';
import { fetchScryfallCardById, ScryfallError } from '../src/main/scryfall.js';

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return vi.fn(async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    }) as Response,
  ) as unknown as typeof fetch;
}

describe('fetchScryfallCardById', () => {
  it('maps Scryfall response to ScryfallCard', async () => {
    const fetchImpl = fakeFetch({
      id: 'abc-123',
      name: 'Lightning Bolt',
      set: 'm10',
      set_name: 'Magic 2010',
      collector_number: '146',
      finishes: ['nonfoil', 'foil'],
      prices: { usd: '1.23', usd_foil: '5.00', usd_etched: null },
    });
    const card = await fetchScryfallCardById('abc-123', fetchImpl);
    expect(card).toEqual({
      scryfall_id: 'abc-123',
      name: 'Lightning Bolt',
      set_code: 'm10',
      set_name: 'Magic 2010',
      collector_number: '146',
      price_usd: 1.23,
      available_finishes: ['normal', 'foil'],
    });
  });

  it('falls back to foil/etched price when usd missing', async () => {
    const fetchImpl = fakeFetch({
      id: 'x',
      name: 'X',
      set: 's',
      set_name: 'S',
      collector_number: '1',
      finishes: ['etched'],
      prices: { usd: null, usd_foil: null, usd_etched: '12.34' },
    });
    const card = await fetchScryfallCardById('x', fetchImpl);
    expect(card.price_usd).toBe(12.34);
    expect(card.available_finishes).toEqual(['etched']);
  });

  it('throws ScryfallError on non-ok response', async () => {
    const fetchImpl = fakeFetch({}, { ok: false, status: 404 });
    await expect(fetchScryfallCardById('bad', fetchImpl)).rejects.toThrow(ScryfallError);
  });

  it('throws on empty id', async () => {
    await expect(fetchScryfallCardById('   ')).rejects.toThrow(/empty/);
  });

  it('sends a descriptive User-Agent', async () => {
    const seen: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      Object.assign(seen, headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'a',
          name: 'A',
          set: 's',
          set_name: 'S',
          collector_number: '1',
          finishes: ['nonfoil'],
          prices: { usd: '0.10' },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    await fetchScryfallCardById('a', fetchImpl);
    expect(seen['User-Agent']).toMatch(/Mimir/);
  });
});
