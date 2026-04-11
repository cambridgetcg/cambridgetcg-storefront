import { query } from "@/lib/db";
import type { MarketOrder, MarketTrade, OrderBookEntry, OrderBookSummary, CardOrderBook } from "./types";
import { COMMISSION_RATE } from "./types";

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
  const { default: pg } = await import("pg");
  const raw = process.env.DATABASE_URL || "";
  const cleaned = raw.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
  const pool = new pg.Pool({ connectionString: cleaned, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  const trades: MarketTrade[] = [];

  try {
    await client.query("BEGIN");

    // Insert the order
    const orderResult = await client.query(
      `INSERT INTO market_orders (user_id, side, sku, card_name, set_code, set_name, image_url, condition, price, quantity, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [data.userId, data.side, data.sku, data.cardName || null, data.setCode || null,
       data.setName || null, data.imageUrl || null, data.condition, data.price.toFixed(2),
       data.quantity, data.notes || null]
    );
    let order = orderResult.rows[0] as MarketOrder;
    let remainingQty = data.quantity;

    // Try to match against opposite side
    // Bids match against asks (lowest ask first). Asks match against bids (highest bid first).
    const oppositeSide = data.side === "bid" ? "ask" : "bid";
    const priceOp = data.side === "bid" ? "<=" : ">=";
    const priceOrder = data.side === "bid" ? "ASC" : "DESC";

    const matchResult = await client.query(
      `SELECT * FROM market_orders
       WHERE sku = $1 AND side = $2 AND status IN ('open', 'partially_filled')
         AND condition = $3 AND price ${priceOp} $4 AND user_id != $5
       ORDER BY price ${priceOrder}, created_at ASC
       FOR UPDATE`,
      [data.sku, oppositeSide, data.condition, data.price.toFixed(2), data.userId]
    );

    for (const match of matchResult.rows) {
      if (remainingQty <= 0) break;

      const matchAvail = match.quantity - match.filled_quantity;
      const fillQty = Math.min(remainingQty, matchAvail);
      // Trade executes at the resting order's price (maker price)
      const tradePrice = parseFloat(match.price);
      const commission = Math.round(tradePrice * fillQty * COMMISSION_RATE * 100) / 100;
      const sellerPayout = tradePrice * fillQty - commission;

      const buyerId = data.side === "bid" ? data.userId : match.user_id;
      const sellerId = data.side === "ask" ? data.userId : match.user_id;
      const bidOrderId = data.side === "bid" ? order.id : match.id;
      const askOrderId = data.side === "ask" ? order.id : match.id;

      const tradeResult = await client.query(
        `INSERT INTO market_trades (bid_order_id, ask_order_id, buyer_id, seller_id, sku, price, quantity, commission_rate, commission_amount, seller_payout)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [bidOrderId, askOrderId, buyerId, sellerId, data.sku,
         tradePrice.toFixed(2), fillQty, COMMISSION_RATE.toFixed(4),
         commission.toFixed(2), sellerPayout.toFixed(2)]
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

  const cards: OrderBookSummary[] = [];
  for (const row of result.rows) {
    // Get last trade + 24h count
    const tradeInfo = await query(
      `SELECT price FROM market_trades WHERE sku = $1 ORDER BY created_at DESC LIMIT 1`,
      [row.sku]
    );
    const tradeCount = await query(
      `SELECT COUNT(*) FROM market_trades WHERE sku = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [row.sku]
    );

    const bestBid = row.best_bid ? parseFloat(row.best_bid) : null;
    const bestAsk = row.best_ask ? parseFloat(row.best_ask) : null;

    cards.push({
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
      last_trade_price: tradeInfo.rows[0]?.price || null,
      trade_count_24h: parseInt(tradeCount.rows[0].count, 10),
    });
  }

  return { cards, total };
}

// ── User's orders ──

export async function getUserOrders(userId: string, status?: string): Promise<MarketOrder[]> {
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
  return result.rows[0] as MarketTrade ?? null;
}
