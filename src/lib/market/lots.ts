// Lot / bundle listings and sales. Parallel data layer to market_orders/
// market_trades — same escrow/payout lifecycle, different matching model
// (fixed-price listing, buy-whole-or-none).

import { query } from "@/lib/db";
import { commissionRateForScore } from "./types";

const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface LotItem {
  sku: string;
  card_name: string | null;
  quantity: number;
}

export interface MarketLot {
  id: string;
  seller_user_id: string;
  title: string;
  description: string | null;
  price: string;
  image_url: string | null;
  status: "active" | "sold" | "cancelled";
  created_at: string;
  updated_at: string;
  // Joined
  seller_username?: string | null;
  seller_name?: string | null;
  items?: LotItem[];
}

export interface LotTrade {
  id: string;
  lot_id: string;
  buyer_user_id: string;
  seller_user_id: string;
  price: string;
  commission_amount: string;
  seller_payout: string;
  escrow_status: string;
  payment_expires_at: string | null;
  stripe_session_id: string | null;
  created_at: string;
}

export async function createLot(data: {
  sellerId: string;
  title: string;
  description?: string;
  price: number;
  imageUrl?: string;
  items: { sku: string; cardName?: string; quantity: number }[];
}): Promise<MarketLot> {
  if (data.items.length === 0) throw new Error("Lot must contain at least one item");

  const { default: pg } = await import("pg");
  const raw = process.env.DATABASE_URL || "";
  const cleaned = raw.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
  const pool = new pg.Pool({ connectionString: cleaned, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const lotRes = await client.query(
      `INSERT INTO market_lots (seller_user_id, title, description, price, image_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.sellerId, data.title, data.description || null, data.price.toFixed(2), data.imageUrl || null]
    );
    const lot = lotRes.rows[0] as MarketLot;

    for (const item of data.items) {
      await client.query(
        `INSERT INTO market_lot_items (lot_id, sku, card_name, quantity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lot_id, sku) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [lot.id, item.sku, item.cardName || null, Math.max(1, item.quantity | 0)]
      );
    }

    await client.query("COMMIT");
    return lot;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function listLots(filters: {
  sellerId?: string;
  status?: "active" | "sold" | "cancelled";
  limit?: number;
  offset?: number;
}): Promise<{ lots: MarketLot[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.sellerId) { conditions.push(`l.seller_user_id = $${idx++}`); params.push(filters.sellerId); }
  if (filters.status)   { conditions.push(`l.status = $${idx++}`);         params.push(filters.status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit || 24, 100);
  const offset = filters.offset || 0;

  const countRes = await query(
    `SELECT COUNT(*)::int FROM market_lots l ${where}`,
    params
  );
  const total = countRes.rows[0].count as number;

  params.push(limit, offset);
  const r = await query(
    `SELECT l.*, u.username AS seller_username, u.name AS seller_name,
            (SELECT COUNT(*)::int FROM market_lot_items WHERE lot_id = l.id) AS item_count,
            (SELECT SUM(quantity)::int FROM market_lot_items WHERE lot_id = l.id) AS total_quantity
       FROM market_lots l
       LEFT JOIN users u ON u.id = l.seller_user_id
       ${where}
      ORDER BY l.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );
  return { lots: r.rows as MarketLot[], total };
}

export async function getLot(id: string): Promise<MarketLot | null> {
  const r = await query(
    `SELECT l.*, u.username AS seller_username, u.name AS seller_name
       FROM market_lots l
       LEFT JOIN users u ON u.id = l.seller_user_id
      WHERE l.id = $1`,
    [id]
  );
  if (r.rows.length === 0) return null;
  const lot = r.rows[0] as MarketLot;
  const items = await query(
    `SELECT sku, card_name, quantity FROM market_lot_items WHERE lot_id = $1 ORDER BY card_name ASC`,
    [id]
  );
  lot.items = items.rows as LotItem[];
  return lot;
}

export async function cancelLot(lotId: string, sellerId: string): Promise<boolean> {
  // Cancellable only when active AND no lot_trades exist past awaiting_payment.
  const r = await query(
    `UPDATE market_lots SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND seller_user_id = $2 AND status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM market_lot_trades
           WHERE lot_id = $1 AND escrow_status NOT IN ('awaiting_payment','cancelled')
        )
      RETURNING id`,
    [lotId, sellerId]
  );
  return r.rows.length > 0;
}

// Atomic purchase: create a lot_trade row in awaiting_payment, mark the lot
// 'sold' (we don't support partial-fills; one successful purchase takes it
// off the market). If payment doesn't complete in 24h a sweep should
// re-activate the lot; for MVP that's a follow-up.
export async function beginLotPurchase(data: {
  lotId: string;
  buyerId: string;
}): Promise<{ ok: true; trade: LotTrade } | { ok: false; error: string }> {
  const { default: pg } = await import("pg");
  const raw = process.env.DATABASE_URL || "";
  const cleaned = raw.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
  const pool = new pg.Pool({ connectionString: cleaned, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const lotRes = await client.query(
      `SELECT * FROM market_lots WHERE id = $1 FOR UPDATE`,
      [data.lotId]
    );
    if (lotRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Lot not found" };
    }
    const lot = lotRes.rows[0];
    if (lot.status !== "active") {
      await client.query("ROLLBACK");
      return { ok: false, error: `Lot is ${lot.status}` };
    }
    if (lot.seller_user_id === data.buyerId) {
      await client.query("ROLLBACK");
      return { ok: false, error: "You can't buy your own lot" };
    }

    // Seller trust → commission rate (same flywheel as market_trades)
    const sellerTrustRes = await client.query(
      `SELECT trust_score FROM users WHERE id = $1`,
      [lot.seller_user_id]
    );
    const trust = sellerTrustRes.rows[0]?.trust_score ?? 0;
    const rate = commissionRateForScore(trust);
    const price = parseFloat(lot.price);
    const commission = Math.round(price * rate * 100) / 100;
    const sellerPayout = price - commission;
    const paymentExpiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS).toISOString();

    const tradeRes = await client.query(
      `INSERT INTO market_lot_trades
         (lot_id, buyer_user_id, seller_user_id, price,
          commission_rate, commission_amount, seller_payout,
          payment_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [data.lotId, data.buyerId, lot.seller_user_id,
       price.toFixed(2), rate.toFixed(4),
       commission.toFixed(2), sellerPayout.toFixed(2),
       paymentExpiresAt]
    );

    // Flip lot to 'sold' immediately; if payment expires the sweep will
    // re-activate it. This prevents two buyers racing for the same lot.
    await client.query(
      `UPDATE market_lots SET status = 'sold', updated_at = NOW() WHERE id = $1`,
      [data.lotId]
    );

    await client.query("COMMIT");
    return { ok: true, trade: tradeRes.rows[0] as LotTrade };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Called from the Stripe webhook on checkout.session.completed when
// metadata.type === 'market_lot_payment'.
export async function markLotTradePaid(tradeId: string, sessionId: string, paymentIntentId: string | null): Promise<void> {
  await query(
    `UPDATE market_lot_trades
        SET escrow_status = 'awaiting_shipment',
            buyer_paid_at = NOW(),
            stripe_session_id = $2,
            stripe_payment_intent = $3,
            updated_at = NOW()
      WHERE id = $1 AND escrow_status = 'awaiting_payment'`,
    [tradeId, sessionId, paymentIntentId]
  );
}

export async function getLotTrade(id: string): Promise<LotTrade | null> {
  const r = await query(`SELECT * FROM market_lot_trades WHERE id = $1`, [id]);
  return (r.rows[0] as LotTrade) ?? null;
}
