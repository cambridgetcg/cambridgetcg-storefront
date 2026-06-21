const WHOLESALE_URL = process.env.WHOLESALE_API_URL || 'https://wholesaletcgdirect.com';
const WHOLESALE_KEY = process.env.WHOLESALE_API_KEY || '';

export interface PriceItem {
  sku: string;
  card_number: string;
  price_gbp: number;
  channel_price?: number;
  stock: number;
  pending_stock: number;
  image_url: string | null;
  name: string | null;
  name_en: string | null;
  set_code: string | null;
  set_name: string | null;
  rarity: string | null;
  category: string | null;
  updated_at: string | null;
}

export interface PricesResponse {
  count: number;
  total: number;
  channel: string;
  items: PriceItem[];
}

export interface GameItem {
  code: string;
  name: string;
  slug: string;
  image_url: string | null;
  card_count: number;
}

export interface SetItem {
  code: string;
  name: string;
  game_code: string;
  card_count: number;
  release_date: string | null;
}

export async function fetchPrices(params?: {
  game?: string;
  set?: string;
  q?: string;
  sort?: string;
  in_stock?: boolean;
  limit?: number;
  offset?: number;
  category?: string;
  channel?: string;
}): Promise<PricesResponse> {
  const url = new URL(WHOLESALE_URL + '/api/v1/prices');
  // Always request cambridgetcg channel pricing unless overridden
  url.searchParams.set('channel', params?.channel ?? 'cambridgetcg');
  if (params?.game) url.searchParams.set('game', params.game);
  if (params?.set) url.searchParams.set('set', params.set);
  if (params?.q) url.searchParams.set('q', params.q);
  if (params?.sort) url.searchParams.set('sort', params.sort);
  if (params?.in_stock) url.searchParams.set('in_stock', 'true');
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.offset) url.searchParams.set('offset', String(params.offset));
  if (params?.category) url.searchParams.set('category', params.category);

  const res = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + WHOLESALE_KEY },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    console.error('[wholesale] prices error', res.status, await res.text().catch(() => ''));
    return { count: 0, total: 0, channel: '', items: [] };
  }
  return res.json();
}

export async function fetchCard(sku: string, channel = 'cambridgetcg'): Promise<PriceItem | null> {
  const res = await fetch(WHOLESALE_URL + '/api/v1/prices/' + encodeURIComponent(sku) + '?channel=' + channel, {
    headers: { Authorization: 'Bearer ' + WHOLESALE_KEY },
    next: { revalidate: 300 },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

// Uncached variant for revenue-critical checks (stock/price at checkout).
// Unlike fetchCard it distinguishes "card does not exist" (null) from
// "wholesale API unavailable" (throws), so callers can fail open on
// outages instead of treating them as zero stock.
export async function fetchCardFresh(sku: string, channel = 'cambridgetcg'): Promise<PriceItem | null> {
  const res = await fetch(WHOLESALE_URL + '/api/v1/prices/' + encodeURIComponent(sku) + '?channel=' + channel, {
    headers: { Authorization: 'Bearer ' + WHOLESALE_KEY },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('wholesale_unavailable: ' + res.status);
  return res.json();
}

export async function fetchGames(): Promise<GameItem[]> {
  const res = await fetch(WHOLESALE_URL + '/api/v1/games', {
    headers: { Authorization: 'Bearer ' + WHOLESALE_KEY },
    next: { revalidate: 600 },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.games || [];
}

export async function fetchSets(game?: string): Promise<SetItem[]> {
  const url = new URL(WHOLESALE_URL + '/api/v1/sets');
  if (game) url.searchParams.set('game', game);
  const res = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + WHOLESALE_KEY },
    next: { revalidate: 600 },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.sets || [];
}

export async function reportSale(sale: {
  channel: string;
  order_ref: string;
  items: { sku: string; qty: number; price_gbp: number }[];
}): Promise<boolean> {
  const res = await fetch(WHOLESALE_URL + '/api/v1/sales', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + WHOLESALE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sale),
  });
  return res.ok;
}
