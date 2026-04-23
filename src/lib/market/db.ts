import { query } from "@/lib/db";
import type { MarketOrder, MarketTrade, OrderBookEntry, OrderBookSummary, CardOrderBook } from "./types";
import { COMMISSION_RATE } from "./types";
import { postActivity, awardAchievement } from "@/lib/social/db";
import { routeTrade } from "@/lib/escrow/service-tiers";
import { sendBuyerMatchEmail, sendSellerMatchEmail, sendCancelEmail } from "./email";
import { formatPrice } from "@/lib/format";

// Default open-order TTL when the caller doesn't specify expires_at.
// 30 days mirrors typical online marketplace conventions.
const DEFAULT_ORDER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// How long a buyer has to pay after a match before the trade auto-cancels.
const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Lazy expiry sweep ──
// Cheap idempotent maintenance fired from any market read. Marks orders past
// their TTL as expired, and cancels trades whose buyer never paid in time
// (restoring the maker's filled_quantity so the order can match again).
let lastSweepAt = 0;
async function sweepExpired(force = false): Promise<void> {
  // Throttle: at most once per minute per process. Reads are frequent;
  // expiry only needs minute-level resolution. Cron entry point passes
  // force=true so it always runs.
  const now = Date.now();
  if (!force && now - lastSweepAt < 60_000) return;
  lastSweepAt = now;

  await query(
    `UPDATE market_orders SET status = 'expired', updated_at = NOW()
      WHERE status IN ('open', 'partially_filled')
        AND expires_at IS NOT NULL AND expires_at <= NOW()`
  );

  // Trades whose payment window elapsed: cancel them and roll back the
  // maker order's filled_quantity so the listing returns to the book.
  const expiredTrades = await query(
    `SELECT id, bid_order_id, ask_order_id, quantity, buyer_id, seller_id
       FROM market_trades
      WHERE escrow_status = 'awaiting_payment'
        AND payment_expires_at IS NOT NULL
        AND payment_expires_at <= NOW()`
  );

  for (const t of expiredTrades.rows) {
    const upd = await query(
      `UPDATE market_trades SET escrow_status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND escrow_status = 'awaiting_payment' RETURNING id`,
      [t.id]
    );
    if (upd.rows.length === 0) continue;
    // Restore both orders. Taker order is the one created at match time —
    // the cleanest behaviour is to restore qty on both and let either side
    // re-match if still active.
    for (const orderId of [t.bid_order_id, t.ask_order_id]) {
      await query(
        `UPDATE market_orders
            SET filled_quantity = GREATEST(filled_quantity - $1, 0),
                status = CASE
                  WHEN GREATEST(filled_quantity - $1, 0) = 0 THEN 'open'
                  WHEN GREATEST(filled_quantity - $1, 0) < quantity THEN 'partially_filled'
                  ELSE status
                END,
                updated_at = NOW()
          WHERE id = $2 AND status IN ('filled', 'partially_filled')`,
        [t.quantity, orderId]
      );
    }

    // Notify both parties about the cancellation
    const participants = await query(
      `SELECT u.email, t.sku, COALESCE(o.card_name, t.sku) AS card_name
         FROM market_trades t
         JOIN users u ON u.id = ANY(ARRAY[t.buyer_id, t.seller_id])
         LEFT JOIN market_orders o ON o.id = t.bid_order_id
        WHERE t.id = $1`,
      [t.id]
    );
    for (const p of participants.rows) {
      sendCancelEmail({
        email: p.email,
        cardName: p.card_name,
        reason: "Buyer did not pay within the 24-hour payment window.",
      }).catch((err) => console.error("[market] Cancel email failed:", err));
    }
  }
}

// ── Place order + attempt match ──

export async function placeOrder(data: {
  userId: string;
  side: "bid" | "ask";
  sku: string;
  cardName?: string;
  setCode?: string;
  setName?: string;
  imageUrl?: string;
  condition: string;
  price: number;
  quantity: number;
  notes?: string;
}): Promise<{ order: MarketOrder; trades: MarketTrade[] }> {
  // Maintenance: opportunistically clear expired orders/trades before matching
  // so this taker doesn't try to fill against stale rows.
  await sweepExpired();

  const { default: pg } = await import("pg");
  const raw = process.env.DATABASE_URL || "";
  const cleaned = raw.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
  const pool = new pg.Pool({ connectionString: cleaned, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  const trades: MarketTrade[] = [];

  try {
    await client.query("BEGIN");

    // Insert the order with a default 30-day TTL
    const expiresAt = new Date(Date.now() + DEFAULT_ORDER_TTL_MS).toISOString();
    const orderResult = await client.query(
      `INSERT INTO market_orders (user_id, side, sku, card_name, set_code, set_name, image_url, condition, price, quantity, notes, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [data.userId, data.side, data.sku, data.cardName || null, data.setCode || null,
       data.setName || null, data.imageUrl || null, data.condition, data.price.toFixed(2),
       data.quantity, data.notes || null, expiresAt]
    );
    let order = orderResult.rows[0] as MarketOrder;
    let remainingQty = data.quantity;

    // Try to match against opposite side. Pull the maker's trust + flag state
    // in the same query so we can route each resulting trade to its escrow
    // tier without a follow-up round trip per match.
    const oppositeSide = data.side === "bid" ? "ask" : "bid";
    const priceOp = data.side === "bid" ? "<=" : ">=";
    const priceOrder = data.side === "bid" ? "ASC" : "DESC";

    const matchResult = await client.query(
      `SELECT o.*, u.trust_score AS maker_trust,
              COALESCE(tp.is_flagged, false) AS maker_flagged
         FROM market_orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN trust_profiles tp ON tp.user_id = o.user_id
        WHERE o.sku = $1 AND o.side = $2
          AND o.status IN ('open', 'partially_filled')
          AND o.condition = $3 AND o.price ${priceOp} $4 AND o.user_id != $5
        ORDER BY o.price ${priceOrder}, o.created_at ASC
        FOR UPDATE OF o`,
      [data.sku, oppositeSide, data.condition, data.price.toFixed(2), data.userId]
    );

    // Taker's trust (one lookup, reused per match)
    const takerTrustRow = await client.query(
      `SELECT u.trust_score, COALESCE(tp.is_flagged, false) AS is_flagged
         FROM users u LEFT JOIN trust_profiles tp ON tp.user_id = u.id
        WHERE u.id = $1`,
      [data.userId]
    );
    const takerTrust = takerTrustRow.rows[0]?.trust_score ?? 0;
    const takerFlagged = takerTrustRow.rows[0]?.is_flagged ?? false;

    for (const match of matchResult.rows) {
      if (remainingQty <= 0) break;

      const matchAvail = match.quantity - match.filled_quantity;
      const fillQty = Math.min(remainingQty, matchAvail);
      // Trade executes at the resting order's price (maker price)
      const tradePrice = parseFloat(match.price);
      const tradeValue = tradePrice * fillQty;
      const commission = Math.round(tradeValue * COMMISSION_RATE * 100) / 100;
      const sellerPayout = tradeValue - commission;

      const buyerId = data.side === "bid" ? data.userId : match.user_id;
      const sellerId = data.side === "ask" ? data.userId : match.user_id;
      const bidOrderId = data.side === "bid" ? order.id : match.id;
      const askOrderId = data.side === "ask" ? order.id : match.id;

      // Resolve escrow tier from trust + value + card metadata so admin and
      // emails can branch on it. Stored on the trade row itself.
      const sellerTrust = sellerId === data.userId ? takerTrust : (match.maker_trust ?? 0);
      const buyerTrust  = buyerId  === data.userId ? takerTrust : (match.maker_trust ?? 0);
      const sellerFlag  = sellerId === data.userId ? takerFlagged : !!match.maker_flagged;
      const buyerFlag   = buyerId  === data.userId ? takerFlagged : !!match.maker_flagged;
      const routing = await routeTrade({
        tradeValue,
        sellerTrustScore: sellerTrust,
        buyerTrustScore: buyerTrust,
        sellerIsFlagged: sellerFlag,
        buyerIsFlagged: buyerFlag,
        cardName: data.cardName || match.card_name || undefined,
        condition: data.condition,
      });

      const paymentExpiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS).toISOString();

      const tradeResult = await client.query(
        `INSERT INTO market_trades
           (bid_order_id, ask_order_id, buyer_id, seller_id, sku, price, quantity,
            commission_rate, commission_amount, seller_payout,
            escrow_tier, requires_photos, requires_inspection, seller_ships_to,
            dispute_window_hours, payout_hold_days, payment_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [bidOrderId, askOrderId, buyerId, sellerId, data.sku,
         tradePrice.toFixed(2), fillQty, COMMISSION_RATE.toFixed(4),
         commission.toFixed(2), sellerPayout.toFixed(2),
         routing.tier, routing.requiresPhotos, routing.requiresInspection,
         routing.sellerShipsTo, routing.disputeWindowHours, routing.payoutHoldDays,
         paymentExpiresAt]
      );
      trades.push(tradeResult.rows[0] as MarketTrade);

      // Update matched order
      const newMatchFilled = match.filled_quantity + fillQty;
      const matchStatus = newMatchFilled >= match.quantity ? "filled" : "partially_filled";
      await client.query(
        `UPDATE market_orders SET filled_quantity = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [newMatchFilled, matchStatus, match.id]
      );

      remainingQty -= fillQty;
    }

    // Update our order
    const newFilled = data.quantity - remainingQty;
    const newStatus = newFilled >= data.quantity ? "filled" : newFilled > 0 ? "partially_filled" : "open";
    await client.query(
      `UPDATE market_orders SET filled_quantity = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [newFilled, newStatus, order.id]
    );
    order = { ...order, filled_quantity: newFilled, status: newStatus };

    await client.query("COMMIT");

    // Match notifications (fire-and-forget). One query for all participant emails.
    if (trades.length > 0) {
      const participantIds = Array.from(new Set(trades.flatMap((t) => [t.buyer_id, t.seller_id])));
      query(
        `SELECT id, email FROM users WHERE id = ANY($1)`,
        [participantIds]
      ).then((r) => {
        const emailById = new Map<string, string>(r.rows.map((u: { id: string; email: string }) => [u.id, u.email]));
        const cardName = data.cardName || data.sku;
        for (const t of trades) {
          const buyerEmail = emailById.get(t.buyer_id);
          const sellerEmail = emailById.get(t.seller_id);
          const total = parseFloat(t.price) * t.quantity;
          if (buyerEmail) {
            sendBuyerMatchEmail({
              email: buyerEmail,
              cardName,
              price: formatPrice(total),
              expiresAt: t.payment_expires_at || new Date().toISOString(),
            }).catch((err) => console.error("[market] Buyer match email failed:", err));
          }
          if (sellerEmail) {
            sendSellerMatchEmail({
              email: sellerEmail,
              cardName,
              price: formatPrice(total),
            }).catch((err) => console.error("[market] Seller match email failed:", err));
          }
        }
      }).catch(() => {});

      for (const trade of trades) {
        postActivity(trade.buyer_id, "trade_completed", "Completed a P2P trade").catch(() => {});
        postActivity(trade.seller_id, "trade_completed", "Completed a P2P trade").catch(() => {});

        // Check trade count milestones for buyer and seller
        for (const tradeUserId of [trade.buyer_id, trade.seller_id]) {
          query(
            `SELECT COUNT(*) FROM market_trades WHERE buyer_id = $1 OR seller_id = $1`,
            [tradeUserId]
          ).then((res) => {
            const count = parseInt(res.rows[0].count, 10);
            if (count === 1) awardAchievement(tradeUserId, "first_trade").catch(() => {});
            if (count === 10) awardAchievement(tradeUserId, "trades_10").catch(() => {});
            if (count === 50) awardAchievement(tradeUserId, "trades_50").catch(() => {});
            if (count === 100) awardAchievement(tradeUserId, "trades_100").catch(() => {});
          }).catch(() => {});
        }
      }
    }

    return { order, trades };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Cancel order ──

export async function cancelOrder(orderId: string, userId: string): Promise<boolean> {
  const result = await query(
    `UPDATE market_orders SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status IN ('open', 'partially_filled') RETURNING id`,
    [orderId, userId]
  );
  return result.rows.length > 0;
}

// ── Order book for a single card ──

export async function getCardOrderBook(sku: string): Promise<CardOrderBook> {
  await sweepExpired();
  // Aggregate bids (descending price)
  const bidsResult = await query(
    `SELECT price, SUM(quantity - filled_quantity) as total_quantity, COUNT(*) as order_count
     FROM market_orders WHERE sku = $1 AND side = 'bid' AND status IN ('open', 'partially_filled')
     GROUP BY price ORDER BY price DESC LIMIT 20`,
    [sku]
  );

  // Aggregate asks (ascending price)
  const asksResult = await query(
    `SELECT price, SUM(quantity - filled_quantity) as total_quantity, COUNT(*) as order_count
     FROM market_orders WHERE sku = $1 AND side = 'ask' AND status IN ('open', 'partially_filled')
     GROUP BY price ORDER BY price ASC LIMIT 20`,
    [sku]
  );

  // Card info from any order
  const cardInfo = await query(
    `SELECT card_name, image_url FROM market_orders WHERE sku = $1 AND card_name IS NOT NULL LIMIT 1`,
    [sku]
  );

  // Recent trades
  const tradesResult = await query(
    `SELECT t.*, bu.name as buyer_name, su.name as seller_name
     FROM market_trades t
     LEFT JOIN users bu ON t.buyer_id = bu.id
     LEFT JOIN users su ON t.seller_id = su.id
     WHERE t.sku = $1 ORDER BY t.created_at DESC LIMIT 20`,
    [sku]
  );

  const bids = bidsResult.rows.map((r) => ({
    price: r.price,
    total_quantity: parseInt(r.total_quantity, 10),
    order_count: parseInt(r.order_count, 10),
  })) as OrderBookEntry[];

  const asks = asksResult.rows.map((r) => ({
    price: r.price,
    total_quantity: parseInt(r.total_quantity, 10),
    order_count: parseInt(r.order_count, 10),
  })) as OrderBookEntry[];

  return {
    sku,
    card_name: cardInfo.rows[0]?.card_name || null,
    image_url: cardInfo.rows[0]?.image_url || null,
    bids,
    asks,
    recent_trades: tradesResult.rows as MarketTrade[],
    best_bid: bids.length > 0 ? bids[0].price : null,
    best_ask: asks.length > 0 ? asks[0].price : null,
  };
}

// ── Browse: cards with active order books ──

export async function getMarketSummaries(filters: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ cards: OrderBookSummary[]; total: number }> {
  await sweepExpired();
  const limit = filters.limit || 24;
  const offset = filters.offset || 0;

  let whereClause = "WHERE o.status IN ('open', 'partially_filled')";
  const params: unknown[] = [];

  if (filters.search) {
    params.push(`%${filters.search}%`);
    whereClause += ` AND (o.card_name ILIKE $${params.length} OR o.sku ILIKE $${params.length})`;
  }

  const countResult = await query(
    `SELECT COUNT(DISTINCT o.sku) FROM market_orders o ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  params.push(limit, offset);
  const result = await query(
    `SELECT
       o.sku,
       MAX(o.card_name) as card_name,
       MAX(o.set_code) as set_code,
       MAX(o.set_name) as set_name,
       MAX(o.image_url) as image_url,
       MAX(CASE WHEN o.side = 'bid' THEN o.price END) as best_bid,
       MIN(CASE WHEN o.side = 'ask' THEN o.price END) as best_ask,
       SUM(CASE WHEN o.side = 'bid' THEN o.quantity - o.filled_quantity ELSE 0 END) as bid_depth,
       SUM(CASE WHEN o.side = 'ask' THEN o.quantity - o.filled_quantity ELSE 0 END) as ask_depth
     FROM market_orders o
     ${whereClause}
     GROUP BY o.sku
     ORDER BY (SUM(o.quantity - o.filled_quantity)) DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // Resolve last-trade-price + 24h trade count for the page in a single
  // round trip rather than 2 queries per row. Uses DISTINCT ON for last
  // trade and a filtered COUNT for the rolling window.
  const skus = result.rows.map((r) => r.sku);
  const tradeStats = skus.length === 0
    ? new Map<string, { lastPrice: string | null; count24h: number }>()
    : await (async () => {
        const r = await query(
          `SELECT sku,
                  MAX(price) FILTER (WHERE rn = 1)             AS last_price,
                  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS count_24h
             FROM (
               SELECT sku, price, created_at,
                      ROW_NUMBER() OVER (PARTITION BY sku ORDER BY created_at DESC) AS rn
                 FROM market_trades
                WHERE sku = ANY($1)
             ) t
            GROUP BY sku`,
          [skus]
        );
        const m = new Map<string, { lastPrice: string | null; count24h: number }>();
        for (const row of r.rows) {
          m.set(row.sku, {
            lastPrice: row.last_price,
            count24h: parseInt(row.count_24h, 10),
          });
        }
        return m;
      })();

  const cards: OrderBookSummary[] = result.rows.map((row) => {
    const bestBid = row.best_bid ? parseFloat(row.best_bid) : null;
    const bestAsk = row.best_ask ? parseFloat(row.best_ask) : null;
    const stats = tradeStats.get(row.sku);
    return {
      sku: row.sku,
      card_name: row.card_name,
      set_code: row.set_code,
      set_name: row.set_name,
      image_url: row.image_url,
      best_bid: row.best_bid,
      best_ask: row.best_ask,
      spread: bestBid && bestAsk ? bestAsk - bestBid : null,
      bid_depth: parseInt(row.bid_depth, 10),
      ask_depth: parseInt(row.ask_depth, 10),
      last_trade_price: stats?.lastPrice ?? null,
      trade_count_24h: stats?.count24h ?? 0,
    };
  });

  return { cards, total };
}

// ── User's orders ──

export async function getUserOrders(userId: string, status?: string): Promise<MarketOrder[]> {
  await sweepExpired();
  const params: unknown[] = [userId];
  let where = "WHERE user_id = $1";
  if (status === "open") {
    where += " AND status IN ('open', 'partially_filled')";
  } else if (status === "filled") {
    where += " AND status = 'filled'";
  }

  const result = await query(
    `SELECT * FROM market_orders ${where} ORDER BY created_at DESC`,
    params
  );
  return result.rows as MarketOrder[];
}

// ── User's trades ──

export async function getUserTrades(userId: string): Promise<MarketTrade[]> {
  await sweepExpired();
  const result = await query(
    `SELECT t.*,
       bu.name as buyer_name, bu.email as buyer_email,
       su.name as seller_name, su.email as seller_email,
       o.card_name, o.image_url
     FROM market_trades t
     LEFT JOIN users bu ON t.buyer_id = bu.id
     LEFT JOIN users su ON t.seller_id = su.id
     LEFT JOIN market_orders o ON t.bid_order_id = o.id
     WHERE t.buyer_id = $1 OR t.seller_id = $1
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return result.rows as MarketTrade[];
}

// ── Admin: all trades ──

export async function getAllTrades(escrowStatus?: string): Promise<MarketTrade[]> {
  const params: unknown[] = [];
  let where = "";
  if (escrowStatus) {
    params.push(escrowStatus);
    where = `WHERE t.escrow_status = $1`;
  }

  const result = await query(
    `SELECT t.*,
       bu.name as buyer_name, bu.email as buyer_email,
       su.name as seller_name, su.email as seller_email,
       o.card_name, o.image_url
     FROM market_trades t
     LEFT JOIN users bu ON t.buyer_id = bu.id
     LEFT JOIN users su ON t.seller_id = su.id
     LEFT JOIN market_orders o ON t.bid_order_id = o.id
     ${where}
     ORDER BY t.created_at DESC`,
    params
  );
  return result.rows as MarketTrade[];
}

// ── Admin: update escrow status ──

export async function updateEscrowStatus(tradeId: string, status: string, data?: {
  trackingToCtcg?: string;
  trackingToBuyer?: string;
  adminNotes?: string;
}): Promise<MarketTrade | null> {
  const timestampField: Record<string, string> = {
    paid: "buyer_paid_at",
    shipped_to_ctcg: "seller_shipped_at",
    received_by_ctcg: "ctcg_received_at",
    verified: "ctcg_verified_at",
    shipped_to_buyer: "shipped_to_buyer_at",
    completed: "completed_at",
  };

  const fields = [`escrow_status = $1`, `updated_at = NOW()`];
  const values: unknown[] = [status];
  let idx = 2;

  if (timestampField[status]) {
    fields.push(`${timestampField[status]} = NOW()`);
  }
  if (data?.trackingToCtcg) {
    fields.push(`tracking_to_ctcg = $${idx++}`);
    values.push(data.trackingToCtcg);
  }
  if (data?.trackingToBuyer) {
    fields.push(`tracking_to_buyer = $${idx++}`);
    values.push(data.trackingToBuyer);
  }
  if (data?.adminNotes) {
    fields.push(`admin_notes = $${idx++}`);
    values.push(data.adminNotes);
  }

  values.push(tradeId);
  const result = await query(
    `UPDATE market_trades SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  const trade = (result.rows[0] as MarketTrade) ?? null;

  // Status-transition notifications. Fire-and-forget; failures don't block
  // the admin's update.
  if (trade) {
    notifyTradeStatusChange(trade).catch((err) =>
      console.error("[market] Status email failed:", err)
    );
  }

  return trade;
}

async function notifyTradeStatusChange(trade: MarketTrade): Promise<void> {
  // Only send for transitions that the parties care about — skip noisy
  // intermediate states like "received_by_ctcg" that the buyer doesn't need.
  const relevant = new Set(["shipped_to_ctcg", "verified", "shipped_to_buyer", "completed", "disputed", "refunded"]);
  if (!relevant.has(trade.escrow_status)) return;

  const { sendStatusEmail } = await import("./email");

  const info = await query(
    `SELECT bu.email AS buyer_email, su.email AS seller_email,
            COALESCE(o.card_name, t.sku) AS card_name
       FROM market_trades t
       JOIN users bu ON bu.id = t.buyer_id
       JOIN users su ON su.id = t.seller_id
       LEFT JOIN market_orders o ON o.id = t.bid_order_id
      WHERE t.id = $1`,
    [trade.id]
  );
  if (info.rows.length === 0) return;
  const { buyer_email, seller_email, card_name } = info.rows[0];

  type Msg = { to: string; subject: string; heading: string; body: string };
  const messages: Msg[] = [];

  switch (trade.escrow_status) {
    case "shipped_to_ctcg":
      messages.push({
        to: buyer_email, subject: `Seller shipped your card to us`,
        heading: "Card on its way to Cambridge TCG",
        body: `The seller has shipped <strong>${card_name}</strong> to us for verification. We'll inspect it and forward it to you.`,
      });
      break;
    case "verified":
      messages.push({
        to: buyer_email, subject: `${card_name} verified — shipping to you next`,
        heading: "Card verified by Cambridge TCG",
        body: `We've inspected and verified <strong>${card_name}</strong>. Shipping it to you next.`,
      });
      break;
    case "shipped_to_buyer": {
      const tracking = trade.tracking_to_buyer ? ` Tracking: <strong>${trade.tracking_to_buyer}</strong>.` : "";
      messages.push({
        to: buyer_email, subject: `${card_name} is on its way`,
        heading: "Your card has shipped",
        body: `<strong>${card_name}</strong> is on its way to you.${tracking}`,
      });
      break;
    }
    case "completed":
      messages.push(
        { to: buyer_email, subject: `Trade complete: ${card_name}`,
          heading: "Trade complete", body: `Your trade for <strong>${card_name}</strong> is complete. Thanks for trading on Cambridge TCG.` },
        { to: seller_email, subject: `Trade complete: ${card_name}`,
          heading: "Trade complete — payout released",
          body: `Trade for <strong>${card_name}</strong> is complete. Your payout of <strong>£${trade.seller_payout}</strong> will be released after the payout-hold window.` }
      );
      break;
    case "disputed":
      messages.push(
        { to: buyer_email, subject: `Dispute opened: ${card_name}`, heading: "Dispute opened", body: `A dispute has been opened on your trade for <strong>${card_name}</strong>. We'll be in touch.` },
        { to: seller_email, subject: `Dispute opened: ${card_name}`, heading: "Dispute opened", body: `A dispute has been opened on your sale of <strong>${card_name}</strong>. We'll be in touch.` }
      );
      break;
    case "refunded":
      messages.push({
        to: buyer_email, subject: `Refund issued: ${card_name}`,
        heading: "Refund issued",
        body: `A refund has been issued for your trade of <strong>${card_name}</strong>.`,
      });
      break;
  }

  await Promise.allSettled(
    messages.map((m) =>
      sendStatusEmail({ email: m.to, cardName: card_name, subject: m.subject, heading: m.heading, body: m.body })
    )
  );
}

// ── Trade photos (verified / full_escrow tiers) ──

export interface TradePhoto {
  id: string;
  trade_id: string;
  uploaded_by: string;
  url: string;
  s3_key: string;
  photo_type: string;
  approved: boolean | null;
  reviewed_at: string | null;
  created_at: string;
}

// Returns { sellerId, buyerId } so callers can authorize seller-only or
// participant-or-admin actions without re-querying.
export async function getTradeParticipants(tradeId: string): Promise<{
  sellerId: string; buyerId: string; escrowStatus: string;
} | null> {
  const r = await query(
    `SELECT seller_id, buyer_id, escrow_status FROM market_trades WHERE id = $1`,
    [tradeId]
  );
  if (r.rows.length === 0) return null;
  return {
    sellerId: r.rows[0].seller_id,
    buyerId: r.rows[0].buyer_id,
    escrowStatus: r.rows[0].escrow_status,
  };
}

export async function addTradePhoto(data: {
  tradeId: string;
  uploadedBy: string;
  url: string;
  s3Key: string;
  photoType?: string;
}): Promise<TradePhoto> {
  const r = await query(
    `INSERT INTO trade_photos (trade_id, uploaded_by, url, s3_key, photo_type)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.tradeId, data.uploadedBy, data.url, data.s3Key, data.photoType || "card"]
  );
  return r.rows[0] as TradePhoto;
}

export async function listTradePhotos(tradeId: string): Promise<TradePhoto[]> {
  const r = await query(
    `SELECT * FROM trade_photos WHERE trade_id = $1 ORDER BY created_at ASC`,
    [tradeId]
  );
  return r.rows as TradePhoto[];
}

export async function reviewTradePhoto(photoId: string, approved: boolean): Promise<TradePhoto | null> {
  const r = await query(
    `UPDATE trade_photos SET approved = $2, reviewed_at = NOW()
      WHERE id = $1 RETURNING *`,
    [photoId, approved]
  );
  return (r.rows[0] as TradePhoto) ?? null;
}

export async function deleteTradePhoto(photoId: string): Promise<string | null> {
  const r = await query(`DELETE FROM trade_photos WHERE id = $1 RETURNING s3_key`, [photoId]);
  return r.rows[0]?.s3_key ?? null;
}

// ── Manual payout recording (provider-agnostic) ──
// Admin-only path. Records that the seller has been paid. For most methods
// this is just a bookkeeping stamp — admin moved money in their own
// dashboard. For method='stripe_connect' we actually call stripe.transfers
// to send the funds, then stamp the row with the transfer id.
//
// Refuses to record a payout twice. Refuses to record before the trade is
// completed (so admin doesn't accidentally pay before fulfillment).
export async function recordTradePayout(data: {
  tradeId: string;
  method: string;        // bank_transfer | paypal | crypto | stripe_connect | mangopay | other
  reference?: string;    // provider txn id, bank ref, etc. Free-form.
}): Promise<{ ok: true; transferId?: string } | { ok: false; error: string }> {
  const tradeRes = await query(
    `SELECT t.escrow_status, t.seller_paid_at, t.seller_payout, t.seller_id,
            su.email AS seller_email,
            COALESCE(o.card_name, t.sku) AS card_name
       FROM market_trades t
       JOIN users su ON su.id = t.seller_id
       LEFT JOIN market_orders o ON o.id = t.bid_order_id
      WHERE t.id = $1`,
    [data.tradeId]
  );
  if (tradeRes.rows.length === 0) return { ok: false, error: "Trade not found." };
  const trade = tradeRes.rows[0];

  if (trade.seller_paid_at) {
    return { ok: false, error: "Payout already recorded for this trade." };
  }
  if (trade.escrow_status !== "completed") {
    return { ok: false, error: `Cannot pay seller until trade is completed (currently ${trade.escrow_status}).` };
  }

  // For Stripe Connect we make the actual transfer here. If it fails the row
  // stays unstamped and admin can retry. The reference is the transfer id;
  // any admin-supplied reference is appended into the metadata description.
  let transferId: string | undefined;
  let storedReference = data.reference || null;
  if (data.method === "stripe_connect") {
    try {
      const { createTransferToSeller } = await import("@/lib/payouts/stripe-connect");
      const result = await createTransferToSeller({
        sellerUserId: trade.seller_id,
        amountGbp: parseFloat(trade.seller_payout),
        description: `Payout for trade ${data.tradeId} (${trade.card_name})`,
        metadata: { tradeId: data.tradeId, kind: "market_trade" },
      });
      transferId = result.transferId;
      storedReference = transferId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stripe transfer failed";
      return { ok: false, error: msg };
    }
  }

  await query(
    `UPDATE market_trades
        SET seller_paid_at = NOW(),
            payout_method = $2,
            payout_reference = $3,
            stripe_transfer_id = $4,
            updated_at = NOW()
      WHERE id = $1`,
    [data.tradeId, data.method, storedReference, transferId || null]
  );

  // Receipt to the seller (fire-and-forget)
  const { sendPayoutEmail } = await import("./email");
  const { formatPrice } = await import("@/lib/format");
  sendPayoutEmail({
    email: trade.seller_email,
    cardName: trade.card_name,
    amount: formatPrice(parseFloat(trade.seller_payout)),
    method: data.method,
    reference: storedReference,
  }).catch((err) => console.error("[market] Payout email failed:", err));

  return { ok: true, transferId };
}

// ── Cron entry point ──
// Bypasses the in-process throttle so the scheduled sweep always runs even
// if a recent read already triggered one in this lambda instance.
export async function runMarketMaintenance(): Promise<void> {
  await sweepExpired(true);
}
