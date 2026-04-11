// Unified market view: CTCG as two-sided market maker
//
// CTCG provides liquidity on BOTH sides:
//   ASK side: catalog retail price (buy from CTCG)
//   BID side: trade-in credit price (sell to CTCG for store credit)
//
// Store credit is the absorption mechanism — it can only be spent at CTCG,
// creating a flywheel: sell cards → get credit → buy cards → sell cards

import { fetchCard } from "@/lib/wholesale/client";
import { retailPrice } from "@/lib/pricing";
import { getCardOrderBook } from "./db";
import type { CardOrderBook, OrderBookEntry } from "./types";

export interface HouseOrderEntry extends OrderBookEntry {
  is_house?: boolean;
  is_credit?: boolean; // true = paid in store credit, not cash
  label?: string;
}

export interface UnifiedMarketView {
  sku: string;
  card_name: string | null;
  card_number: string | null;
  set_code: string | null;
  set_name: string | null;
  image_url: string | null;
  rarity: string | null;

  // CTCG spot price (always-available liquidity — sell side)
  spot_price: number | null;
  spot_stock: number;

  // CTCG trade-in (always-available liquidity — buy side)
  tradein_credit: number | null;  // Store credit offer
  tradein_cash: number | null;    // Cash offer (lower)

  // Merged order book (CTCG injected on BOTH sides)
  bids: HouseOrderEntry[];
  asks: HouseOrderEntry[];
  recent_trades: CardOrderBook["recent_trades"];

  // Derived
  best_bid: number | null;
  best_ask: number | null;
  market_price: number | null;
  spread: number | null;
  p2p_discount: number | null;
  ctcg_spread: number | null;    // retail - tradein credit = CTCG margin
}

export async function getUnifiedMarketView(sku: string): Promise<UnifiedMarketView> {
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

  // ── Build ASKS (sell side) ──
  // Inject CTCG retail price as house ask
  const asks: HouseOrderEntry[] = [...orderBook.asks];
  if (spotPrice && spotStock > 0) {
    let inserted = false;
    for (let i = 0; i < asks.length; i++) {
      if (spotPrice <= parseFloat(asks[i].price)) {
        asks.splice(i, 0, {
          price: spotPrice.toFixed(2),
          total_quantity: spotStock,
          order_count: 1,
          is_house: true,
          label: "CTCG Store",
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
        label: "CTCG Store",
      });
    }
  }

  // ── Build BIDS (buy side) ──
  // Inject CTCG trade-in credit as house bid (always willing to buy at this price)
  const bids: HouseOrderEntry[] = [...orderBook.bids];
  if (tradeinCredit && tradeinCredit > 0) {
    // Insert at correct position (bids sorted descending by price)
    let inserted = false;
    for (let i = 0; i < bids.length; i++) {
      if (tradeinCredit >= parseFloat(bids[i].price)) {
        bids.splice(i, 0, {
          price: tradeinCredit.toFixed(2),
          total_quantity: 999, // Always willing to buy
          order_count: 1,
          is_house: true,
          is_credit: true,
          label: "CTCG Credit",
        });
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      bids.push({
        price: tradeinCredit.toFixed(2),
        total_quantity: 999,
        order_count: 1,
        is_house: true,
        is_credit: true,
        label: "CTCG Credit",
      });
    }
  }

  const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : null;
  const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

  let p2pDiscount: number | null = null;
  if (spotPrice && bestAsk && bestAsk < spotPrice) {
    p2pDiscount = Math.round(((spotPrice - bestAsk) / spotPrice) * 100);
  }

  const ctcgSpread = spotPrice && tradeinCredit ? spotPrice - tradeinCredit : null;

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
    bids,
    asks,
    recent_trades: orderBook.recent_trades,
    best_bid: bestBid,
    best_ask: bestAsk,
    market_price: bestAsk,
    spread,
    p2p_discount: p2pDiscount,
    ctcg_spread: ctcgSpread,
  };
}
