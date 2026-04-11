// Unified market view: merges CTCG spot prices with P2P order book
// CTCG's catalog price acts as a standing ask (market maker liquidity)

import { fetchCard, type PriceItem } from "@/lib/wholesale/client";
import { retailPrice } from "@/lib/pricing";
import { getCardOrderBook } from "./db";
import type { CardOrderBook, OrderBookEntry } from "./types";

export interface UnifiedMarketView {
  sku: string;
  card_name: string | null;
  card_number: string | null;
  set_code: string | null;
  set_name: string | null;
  image_url: string | null;
  rarity: string | null;

  // CTCG spot price (always-available liquidity)
  spot_price: number | null;
  spot_stock: number;

  // Trade-in prices (helps sellers price their asks)
  tradein_credit: number | null;
  tradein_cash: number | null;

  // Merged order book (CTCG ask injected into P2P asks)
  bids: OrderBookEntry[];
  asks: (OrderBookEntry & { is_house?: boolean })[];
  recent_trades: CardOrderBook["recent_trades"];

  // Derived
  best_bid: number | null;
  best_ask: number | null;     // cheapest available (could be P2P or CTCG)
  market_price: number | null; // = best_ask (cheapest way to buy)
  spread: number | null;
  p2p_discount: number | null; // % cheaper than CTCG spot (if P2P ask < spot)
}

export async function getUnifiedMarketView(sku: string): Promise<UnifiedMarketView> {
  // Fetch all data in parallel
  const [card, orderBook, tradeinCreditCard, tradeinCashCard] = await Promise.all([
    fetchCard(sku).catch(() => null),
    getCardOrderBook(sku),
    fetchCard(sku, "tradein-credit").catch(() => null),
    fetchCard(sku, "tradein-cash").catch(() => null),
  ]);

  const tradeinCredit = tradeinCreditCard?.channel_price ?? null;
  const tradeinCash = tradeinCashCard?.channel_price ?? null;

  const spotPrice = card ? retailPrice(card.price_gbp, card.channel_price) : null;
  const spotStock = card?.stock ?? 0;

  // Inject CTCG house ask into the order book
  const asks: (OrderBookEntry & { is_house?: boolean })[] = [...orderBook.asks];

  if (spotPrice && spotStock > 0) {
    // Find where to insert CTCG's price in the sorted asks (ascending)
    let inserted = false;
    for (let i = 0; i < asks.length; i++) {
      if (spotPrice <= parseFloat(asks[i].price)) {
        asks.splice(i, 0, {
          price: spotPrice.toFixed(2),
          total_quantity: spotStock,
          order_count: 1,
          is_house: true,
        });
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      asks.push({
        price: spotPrice.toFixed(2),
        total_quantity: spotStock,
        order_count: 1,
        is_house: true,
      });
    }
  }

  const bestBid = orderBook.bids.length > 0 ? parseFloat(orderBook.bids[0].price) : null;
  const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

  // P2P discount: how much cheaper is the best P2P ask vs CTCG spot?
  let p2pDiscount: number | null = null;
  if (spotPrice && bestAsk && bestAsk < spotPrice) {
    p2pDiscount = Math.round(((spotPrice - bestAsk) / spotPrice) * 100);
  }

  return {
    sku,
    card_name: card?.name_en || card?.name || orderBook.card_name,
    card_number: card?.card_number || null,
    set_code: card?.set_code || null,
    set_name: card?.set_name || null,
    image_url: card?.image_url || orderBook.image_url,
    rarity: card?.rarity || null,
    spot_price: spotPrice,
    spot_stock: spotStock,
    tradein_credit: tradeinCredit,
    tradein_cash: tradeinCash,
    bids: orderBook.bids,
    asks,
    recent_trades: orderBook.recent_trades,
    best_bid: bestBid,
    best_ask: bestAsk,
    market_price: bestAsk,
    spread,
    p2p_discount: p2pDiscount,
  };
}

// Enrich market summaries with spot prices for the browse page
export async function enrichWithSpotPrices(
  skus: string[]
): Promise<Map<string, { spot_price: number; stock: number }>> {
  const result = new Map<string, { spot_price: number; stock: number }>();

  // Batch fetch — get all cards' prices from wholesale
  // This is called per-page so we do individual fetches (wholesale API doesn't have batch by SKU)
  await Promise.all(
    skus.map(async (sku) => {
      try {
        const card = await fetchCard(sku);
        if (card) {
          result.set(sku, {
            spot_price: retailPrice(card.price_gbp, card.channel_price),
            stock: card.stock,
          });
        }
      } catch {
        // Skip failed lookups
      }
    })
  );

  return result;
}
