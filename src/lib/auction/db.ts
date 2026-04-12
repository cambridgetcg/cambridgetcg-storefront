import { query } from "@/lib/db";
import type { Auction, AuctionImage, AuctionSummary, AuctionDetail, Bid, CreateAuctionInput, BidResult } from "./types";
import { postActivity, awardAchievement } from "@/lib/social/db";

// ── List auctions (public) ──

export async function listAuctions(filters: {
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ auctions: AuctionSummary[]; total: number }> {
  // Lazy status transitions first
  await transitionScheduledToLive();
  await transitionLiveToEnded();

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status === "live") {
    conditions.push(`a.status = 'live'`);
  } else if (filters.status === "upcoming") {
    conditions.push(`a.status = 'scheduled'`);
  } else if (filters.status === "ended") {
    conditions.push(`a.status IN ('ended', 'paid')`);
  }

  if (filters.type) {
    conditions.push(`a.auction_type = $${idx++}`);
    params.push(filters.type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 20;
  const offset = filters.offset || 0;

  const countResult = await query(
    `SELECT COUNT(*) FROM auctions a ${where}`,
    params
  );

  const orderBy = filters.status === "ended" ? "a.ends_at DESC" : "a.ends_at ASC";
  const result = await query(
    `SELECT a.id, a.title, a.auction_type, a.status, a.current_price, a.starting_price,
            a.buy_now_price, a.bid_count, a.starts_at, a.ends_at,
            (SELECT url FROM auction_images WHERE auction_id = a.id ORDER BY display_order LIMIT 1) as image_url
     FROM auctions a ${where}
     ORDER BY ${orderBy}
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return {
    auctions: result.rows as AuctionSummary[],
    total: parseInt(countResult.rows[0].count, 10),
  };
}

// ── Get single auction detail ──

export async function getAuction(id: string): Promise<AuctionDetail | null> {
  await transitionScheduledToLive();
  await transitionLiveToEnded();

  const result = await query(`SELECT * FROM auctions WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const auction = result.rows[0] as Auction;

  const images = await query(
    `SELECT * FROM auction_images WHERE auction_id = $1 ORDER BY display_order`,
    [id]
  );

  const bids = await query(
    `SELECT b.*, u.name as user_name FROM auction_bids b
     LEFT JOIN users u ON b.user_id = u.id
     WHERE b.auction_id = $1 ORDER BY b.created_at DESC LIMIT 50`,
    [id]
  );

  return {
    ...auction,
    images: images.rows as AuctionImage[],
    bids: bids.rows as Bid[],
    server_time: new Date().toISOString(),
  };
}

// ── Create auction (admin) ──

export async function createAuction(data: CreateAuctionInput): Promise<Auction> {
  const currentPrice = data.auction_type === "dutch"
    ? data.dutch_start_price || data.starting_price
    : data.starting_price;

  const result = await query(
    `INSERT INTO auctions (title, description, auction_type, starting_price, reserve_price,
      buy_now_price, bid_increment, dutch_start_price, dutch_end_price, dutch_price_drop,
      dutch_drop_interval_seconds, starts_at, ends_at, current_price, allow_best_offer)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      data.title,
      data.description || null,
      data.auction_type,
      data.starting_price.toFixed(2),
      data.reserve_price?.toFixed(2) ?? null,
      data.buy_now_price?.toFixed(2) ?? null,
      (data.bid_increment || 1).toFixed(2),
      data.dutch_start_price?.toFixed(2) ?? null,
      data.dutch_end_price?.toFixed(2) ?? null,
      data.dutch_price_drop?.toFixed(2) ?? null,
      data.dutch_drop_interval_seconds ?? null,
      data.starts_at,
      data.ends_at,
      (currentPrice as number).toFixed(2),
      data.allow_best_offer || false,
    ]
  );

  return result.rows[0] as Auction;
}

// ── Update auction (admin) ──

export async function updateAuction(id: string, data: Partial<CreateAuctionInput> & { status?: string }): Promise<Auction | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Record<string, unknown> = {
    title: data.title,
    description: data.description,
    auction_type: data.auction_type,
    starting_price: data.starting_price?.toFixed(2),
    reserve_price: data.reserve_price?.toFixed(2),
    buy_now_price: data.buy_now_price?.toFixed(2),
    bid_increment: data.bid_increment?.toFixed(2),
    dutch_start_price: data.dutch_start_price?.toFixed(2),
    dutch_end_price: data.dutch_end_price?.toFixed(2),
    dutch_price_drop: data.dutch_price_drop?.toFixed(2),
    dutch_drop_interval_seconds: data.dutch_drop_interval_seconds,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    allow_best_offer: data.allow_best_offer,
    status: data.status,
  };

  for (const [key, val] of Object.entries(fieldMap)) {
    if (val !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }

  if (fields.length === 0) return null;
  fields.push("updated_at = NOW()");
  values.push(id);

  const result = await query(
    `UPDATE auctions SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] as Auction ?? null;
}

// ── Delete auction (admin, draft only) ──

export async function deleteAuction(id: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM auctions WHERE id = $1 AND status = 'draft' RETURNING id`,
    [id]
  );
  return result.rows.length > 0;
}

// ── Place bid (transactional) ──

export async function placeBid(auctionId: string, userId: string, amount: number): Promise<BidResult> {
  const { default: pg } = await import("pg");
  const raw = process.env.DATABASE_URL || "";
  const cleaned = raw.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
  const pool = new pg.Pool({ connectionString: cleaned, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const auctionResult = await client.query(
      `SELECT * FROM auctions WHERE id = $1 AND status = 'live' FOR UPDATE`,
      [auctionId]
    );

    if (auctionResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { success: false, error: "Auction is not active." };
    }

    const auction = auctionResult.rows[0];
    const currentPrice = parseFloat(auction.current_price);
    const increment = parseFloat(auction.bid_increment);
    const minBid = auction.bid_count > 0 ? currentPrice + increment : parseFloat(auction.starting_price);

    if (amount < minBid) {
      await client.query("ROLLBACK");
      return { success: false, error: `Minimum bid is £${minBid.toFixed(2)}.` };
    }

    if (new Date(auction.ends_at) <= new Date()) {
      await client.query("ROLLBACK");
      return { success: false, error: "Auction has ended." };
    }

    // Place the bid
    const bidResult = await client.query(
      `INSERT INTO auction_bids (auction_id, user_id, amount, status)
       VALUES ($1, $2, $3, 'active') RETURNING *`,
      [auctionId, userId, amount.toFixed(2)]
    );

    // Mark previous active bids as outbid
    await client.query(
      `UPDATE auction_bids SET status = 'outbid'
       WHERE auction_id = $1 AND status = 'active' AND id != $2`,
      [auctionId, bidResult.rows[0].id]
    );

    // Update auction
    await client.query(
      `UPDATE auctions SET current_price = $1, bid_count = bid_count + 1, updated_at = NOW()
       WHERE id = $2`,
      [amount.toFixed(2), auctionId]
    );

    await client.query("COMMIT");

    return {
      success: true,
      bid: bidResult.rows[0] as Bid,
      auction: { ...auction, current_price: amount.toFixed(2), bid_count: auction.bid_count + 1 },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Bid history ──

export async function getBidHistory(auctionId: string): Promise<Bid[]> {
  const result = await query(
    `SELECT b.*, u.name as user_name FROM auction_bids b
     LEFT JOIN users u ON b.user_id = u.id
     WHERE b.auction_id = $1 ORDER BY b.created_at DESC`,
    [auctionId]
  );
  return result.rows as Bid[];
}

// ── Images ──

export async function addAuctionImage(auctionId: string, url: string, s3Key: string, order: number): Promise<AuctionImage> {
  const result = await query(
    `INSERT INTO auction_images (auction_id, url, s3_key, display_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [auctionId, url, s3Key, order]
  );
  return result.rows[0] as AuctionImage;
}

export async function removeAuctionImage(imageId: string): Promise<string | null> {
  const result = await query(
    `DELETE FROM auction_images WHERE id = $1 RETURNING s3_key`,
    [imageId]
  );
  return result.rows[0]?.s3_key ?? null;
}

// ── Watch ──

export async function toggleWatch(userId: string, auctionId: string): Promise<boolean> {
  const existing = await query(
    `SELECT 1 FROM auction_watches WHERE user_id = $1 AND auction_id = $2`,
    [userId, auctionId]
  );

  if (existing.rows.length > 0) {
    await query(`DELETE FROM auction_watches WHERE user_id = $1 AND auction_id = $2`, [userId, auctionId]);
    return false;
  }

  await query(
    `INSERT INTO auction_watches (user_id, auction_id) VALUES ($1, $2)`,
    [userId, auctionId]
  );
  return true;
}

export async function isWatching(userId: string, auctionId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM auction_watches WHERE user_id = $1 AND auction_id = $2`,
    [userId, auctionId]
  );
  return result.rows.length > 0;
}

// ── All auctions for admin ──

export async function listAllAuctions(): Promise<AuctionSummary[]> {
  const result = await query(
    `SELECT a.id, a.title, a.auction_type, a.status, a.current_price, a.starting_price,
            a.buy_now_price, a.bid_count, a.starts_at, a.ends_at,
            (SELECT url FROM auction_images WHERE auction_id = a.id ORDER BY display_order LIMIT 1) as image_url
     FROM auctions a ORDER BY a.created_at DESC`
  );
  return result.rows as AuctionSummary[];
}

// ── Customer-created auctions ──

export async function createSellerAuction(userId: string, data: {
  title: string;
  description?: string;
  auction_type: string;
  starting_price: number;
  reserve_price?: number;
  buy_now_price?: number;
  bid_increment?: number;
  starts_at: string;
  ends_at: string;
  allow_best_offer?: boolean;
}): Promise<Auction> {
  const currentPrice = data.starting_price;

  const result = await query(
    `INSERT INTO auctions (title, description, auction_type, starting_price, reserve_price,
      buy_now_price, bid_increment, starts_at, ends_at, current_price, allow_best_offer,
      seller_user_id, is_consignment, approval_status, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,'pending_review','draft')
     RETURNING *`,
    [
      data.title,
      data.description || null,
      data.auction_type,
      data.starting_price.toFixed(2),
      data.reserve_price?.toFixed(2) ?? null,
      data.buy_now_price?.toFixed(2) ?? null,
      (data.bid_increment || 1).toFixed(2),
      data.starts_at,
      data.ends_at,
      currentPrice.toFixed(2),
      data.allow_best_offer || false,
      userId,
    ]
  );

  // Social: activity feed + achievement
  postActivity(userId, "auction_listed", "Listed a card at auction").catch(() => {});
  awardAchievement(userId, "first_auction").catch(() => {});

  return result.rows[0] as Auction;
}

export async function approveAuction(auctionId: string, notes?: string): Promise<Auction | null> {
  const result = await query(
    `UPDATE auctions SET approval_status = 'approved', approval_notes = $2,
     status = 'scheduled', updated_at = NOW()
     WHERE id = $1 AND approval_status = 'pending_review' RETURNING *`,
    [auctionId, notes || null]
  );
  return result.rows[0] as Auction ?? null;
}

export async function rejectAuction(auctionId: string, notes: string): Promise<Auction | null> {
  const result = await query(
    `UPDATE auctions SET approval_status = 'rejected', approval_notes = $2,
     status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND approval_status = 'pending_review' RETURNING *`,
    [auctionId, notes]
  );
  return result.rows[0] as Auction ?? null;
}

export async function getUserAuctions(userId: string): Promise<AuctionSummary[]> {
  const result = await query(
    `SELECT a.id, a.title, a.auction_type, a.status, a.current_price, a.starting_price,
            a.buy_now_price, a.bid_count, a.starts_at, a.ends_at,
            a.approval_status, a.seller_commission_rate, a.seller_payout,
            (SELECT url FROM auction_images WHERE auction_id = a.id ORDER BY display_order LIMIT 1) as image_url
     FROM auctions a WHERE a.seller_user_id = $1 ORDER BY a.created_at DESC`,
    [userId]
  );
  return result.rows as AuctionSummary[];
}

export async function getPendingApprovalAuctions(): Promise<AuctionSummary[]> {
  const result = await query(
    `SELECT a.id, a.title, a.auction_type, a.status, a.current_price, a.starting_price,
            a.buy_now_price, a.bid_count, a.starts_at, a.ends_at,
            a.approval_status, a.seller_user_id, a.seller_commission_rate,
            (SELECT url FROM auction_images WHERE auction_id = a.id ORDER BY display_order LIMIT 1) as image_url,
            u.name as seller_name, u.email as seller_email
     FROM auctions a
     LEFT JOIN users u ON a.seller_user_id = u.id
     WHERE a.approval_status = 'pending_review'
     ORDER BY a.created_at ASC`
  );
  return result.rows as AuctionSummary[];
}

export async function calculateSellerPayout(auctionId: string): Promise<{ payout: number; commission: number } | null> {
  const result = await query(`SELECT * FROM auctions WHERE id = $1`, [auctionId]);
  if (result.rows.length === 0) return null;
  const auction = result.rows[0];
  const salePrice = parseFloat(auction.current_price);
  const rate = parseFloat(auction.seller_commission_rate || "0.12");
  const commission = Math.round(salePrice * rate * 100) / 100;
  const payout = salePrice - commission;

  await query(
    `UPDATE auctions SET seller_payout = $1, updated_at = NOW() WHERE id = $2`,
    [payout.toFixed(2), auctionId]
  );

  return { payout, commission };
}

// ── Lazy status transitions ──

async function transitionScheduledToLive(): Promise<void> {
  await query(
    `UPDATE auctions SET status = 'live', updated_at = NOW()
     WHERE status = 'scheduled' AND starts_at <= NOW()`
  );
}

async function transitionLiveToEnded(): Promise<void> {
  // Find auctions that should end and set winner
  const ended = await query(
    `UPDATE auctions SET status = 'ended', actual_end_at = NOW(), updated_at = NOW()
     WHERE status = 'live' AND ends_at <= NOW()
     RETURNING id`
  );

  // Set winners for ended auctions
  for (const row of ended.rows) {
    const highBid = await query(
      `SELECT user_id FROM auction_bids WHERE auction_id = $1 AND status = 'active'
       ORDER BY amount DESC LIMIT 1`,
      [row.id]
    );
    if (highBid.rows.length > 0) {
      await query(
        `UPDATE auctions SET winner_user_id = $1 WHERE id = $2`,
        [highBid.rows[0].user_id, row.id]
      );
      await query(
        `UPDATE auction_bids SET status = 'winning' WHERE auction_id = $1 AND status = 'active'`,
        [row.id]
      );
    }
  }
}
