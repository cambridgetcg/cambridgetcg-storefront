// Trust Score Engine — calculates trust from trading history, reviews, and behavior
//
// Score components (0-100):
//   Trade completion rate    (30 pts) — completed / total trades
//   Review score             (25 pts) — avg rating * 5
//   Trade volume             (15 pts) — log scale of total volume
//   Account age              (10 pts) — months since first trade
//   Verification             (10 pts) — UK verified = 10, unverified = 0
//   External reputation      (10 pts) — verified cross-platform accounts
//
// Penalties:
//   Active dispute           -10 per open dispute
//   Dispute lost             -15 per lost dispute
//   Fraud signal (medium+)   -20 per unresolved signal
//   Suspension history       -30

import { query } from "@/lib/db";
import type { TrustProfile, FraudSignal } from "./types";
import { TRUST_TIERS, FRAUD_SIGNALS } from "./types";

export async function calculateTrustScore(userId: string): Promise<TrustProfile> {
  // Ensure trust profile exists
  await query(
    `INSERT INTO trust_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  // Fetch all data for scoring
  const [tradesResult, reviewsResult, userResult, fraudResult, externalResult] = await Promise.all([
    query(`SELECT * FROM market_trades WHERE buyer_id=$1 OR seller_id=$1`, [userId]),
    query(`SELECT * FROM trade_reviews WHERE reviewee_id=$1 AND admin_hidden=false`, [userId]),
    query(`SELECT * FROM users u LEFT JOIN user_verifications v ON u.id=v.user_id WHERE u.id=$1`, [userId]),
    query(`SELECT * FROM fraud_signals WHERE user_id=$1 AND resolved=false`, [userId]),
    query(`SELECT * FROM external_reputation WHERE user_id=$1 AND verified=true`, [userId]),
  ]);

  const trades = tradesResult.rows;
  const reviews = reviewsResult.rows;
  const user = userResult.rows[0];
  const fraudSignals = fraudResult.rows;
  const externalReps = externalResult.rows;

  const totalTrades = trades.length;
  const completedTrades = trades.filter(t => t.escrow_status === "completed").length;
  const cancelledTrades = trades.filter(t => t.escrow_status === "cancelled").length;
  const disputedTrades = trades.filter(t => t.escrow_status === "disputed" || t.escrow_status === "refunded").length;

  // ── Score components ──

  // 1. Completion rate (30 pts)
  const completionRate = totalTrades > 0 ? completedTrades / totalTrades : 0;
  const completionScore = Math.round(completionRate * 30);

  // 2. Review score (25 pts)
  const avgRating = reviews.length > 0
    ? reviews.reduce((s: number, r: { rating: number }) => s + r.rating, 0) / reviews.length
    : 0;
  const reviewScore = Math.round((avgRating / 5) * 25);
  const positiveReviews = reviews.filter((r: { rating: number }) => r.rating >= 4).length;
  const negativeReviews = reviews.filter((r: { rating: number }) => r.rating <= 2).length;

  // 3. Volume (15 pts) — logarithmic scale
  const totalVolume = trades.reduce((s: number, t: { price: string }) => s + parseFloat(t.price || "0"), 0);
  const largestTrade = Math.max(0, ...trades.map((t: { price: string }) => parseFloat(t.price || "0")));
  const volumeScore = Math.min(15, Math.round(Math.log10(Math.max(1, totalVolume)) * 5));

  // 4. Account age (10 pts)
  const firstTrade = trades.length > 0
    ? new Date(trades.reduce((min: string, t: { created_at: string }) => t.created_at < min ? t.created_at : min, trades[0].created_at))
    : new Date();
  const monthsActive = Math.max(0, (Date.now() - firstTrade.getTime()) / (30 * 24 * 60 * 60 * 1000));
  const ageScore = Math.min(10, Math.round(monthsActive * 2));

  // 5. Verification (10 pts)
  const isVerified = user?.is_verified === true;
  const verificationScore = isVerified ? 10 : 0;

  // 6. External reputation (10 pts)
  const externalScore = Math.min(10, externalReps.length * 5);

  // ── Penalties ──
  const openDisputes = trades.filter((t: { escrow_status: string }) => t.escrow_status === "disputed").length;
  const disputesLost = disputedTrades; // Simplified — refunded = lost
  const mediumPlusFraud = fraudSignals.filter((f: { severity: string }) => f.severity !== "low").length;

  const penalties =
    (openDisputes * 10) +
    (disputesLost * 15) +
    (mediumPlusFraud * 20);

  // ── Final score ──
  const rawScore = completionScore + reviewScore + volumeScore + ageScore + verificationScore + externalScore;
  const trustScore = Math.max(0, Math.min(100, rawScore - penalties));

  // Determine trust tier and limits
  const tier = [...TRUST_TIERS].reverse().find(t => trustScore >= t.minScore) || TRUST_TIERS[0];

  // Update profile
  await query(
    `UPDATE trust_profiles SET
       trust_score=$2, seller_score=$2, buyer_score=$2,
       total_trades=$3, completed_trades=$4, cancelled_trades=$5,
       disputed_trades=$6, disputes_won=0, disputes_lost=$7,
       avg_rating=$8, total_reviews=$9, positive_reviews=$10, negative_reviews=$11,
       total_volume=$12, largest_trade=$13,
       trade_limit=$14, daily_limit=$15, requires_escrow_inspection=$16,
       last_calculated_at=NOW(), updated_at=NOW()
     WHERE user_id=$1`,
    [userId, trustScore, totalTrades, completedTrades, cancelledTrades,
     disputedTrades, disputesLost, avgRating.toFixed(2), reviews.length,
     positiveReviews, negativeReviews, totalVolume.toFixed(2), largestTrade.toFixed(2),
     tier.tradeLimit.toFixed(2), tier.dailyLimit.toFixed(2), tier.requiresInspection]
  );

  // Update user's trust score
  await query(`UPDATE users SET trust_score=$2, trade_count=$3 WHERE id=$1`, [userId, trustScore, totalTrades]);

  const profile = await query(`SELECT * FROM trust_profiles WHERE user_id=$1`, [userId]);
  return profile.rows[0] as TrustProfile;
}

// ── Pre-trade checks ──

export async function canTrade(userId: string, tradeValue: number): Promise<{
  allowed: boolean;
  reason?: string;
  warnings: string[];
}> {
  const profile = await calculateTrustScore(userId);
  const warnings: string[] = [];

  if (profile.is_suspended) {
    return { allowed: false, reason: `Account suspended: ${profile.suspended_reason}`, warnings };
  }

  if (profile.is_flagged) {
    warnings.push("Account flagged for review — trades may be held for inspection.");
  }

  if (tradeValue > parseFloat(profile.trade_limit)) {
    return { allowed: false, reason: `Trade value £${tradeValue.toFixed(2)} exceeds your limit of £${profile.trade_limit}. Build trust by completing smaller trades.`, warnings };
  }

  // Check daily volume
  const todayVolume = await query(
    `SELECT COALESCE(SUM(price::numeric), 0) as vol FROM market_trades
     WHERE (buyer_id=$1 OR seller_id=$1) AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  const dailyVol = parseFloat(todayVolume.rows[0].vol);
  if (dailyVol + tradeValue > parseFloat(profile.daily_limit)) {
    return { allowed: false, reason: `Daily trading limit reached (£${profile.daily_limit}/day). Try again tomorrow.`, warnings };
  }

  return { allowed: true, warnings };
}

// ── Fraud detection ──

export async function checkFraudSignals(userId: string, context: {
  tradeValue?: number;
  counterpartyId?: string;
  action?: string;
}): Promise<FraudSignal[]> {
  const signals: FraudSignal[] = [];

  // New account + high value
  const user = await query(`SELECT created_at, trade_count FROM users WHERE id=$1`, [userId]);
  const accountAge = (Date.now() - new Date(user.rows[0]?.created_at).getTime()) / (24 * 60 * 60 * 1000);

  if (accountAge < 7 && (context.tradeValue || 0) > 100) {
    const signal = FRAUD_SIGNALS.NEW_ACCOUNT_HIGH_VALUE;
    await recordSignal(userId, context.tradeValue ? undefined : undefined, signal.type, signal.severity, signal.desc, "flag");
    signals.push({ id: "", user_id: userId, trade_id: null, ...signal, signal_type: signal.type, auto_action: "flag", resolved: false, created_at: "" });
  }

  // Self-trading check (same buyer and seller — should be blocked at API level too)
  if (context.counterpartyId && context.counterpartyId === userId) {
    const signal = FRAUD_SIGNALS.SELF_TRADING;
    await recordSignal(userId, null, signal.type, signal.severity, signal.desc, "block_trade");
    signals.push({ id: "", user_id: userId, trade_id: null, ...signal, signal_type: signal.type, auto_action: "block_trade", resolved: false, created_at: "" });
  }

  // Rapid listing (more than 20 in an hour)
  if (context.action === "list") {
    const recentListings = await query(
      `SELECT COUNT(*) FROM market_orders WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );
    if (parseInt(recentListings.rows[0].count) > 20) {
      const signal = FRAUD_SIGNALS.RAPID_LISTING;
      await recordSignal(userId, null, signal.type, signal.severity, signal.desc, "flag");
      signals.push({ id: "", user_id: userId, trade_id: null, ...signal, signal_type: signal.type, auto_action: "flag", resolved: false, created_at: "" });
    }
  }

  // Multiple recent disputes
  const recentDisputes = await query(
    `SELECT COUNT(*) FROM trade_disputes WHERE raised_by=$1 AND created_at > NOW() - INTERVAL '30 days'`,
    [userId]
  );
  if (parseInt(recentDisputes.rows[0].count) >= 3) {
    const signal = FRAUD_SIGNALS.MULTIPLE_DISPUTES;
    await recordSignal(userId, null, signal.type, signal.severity, signal.desc, "hold_payout");
  }

  return signals;
}

async function recordSignal(userId: string, tradeId: string | null | undefined, type: string, severity: string, desc: string, action: string) {
  await query(
    `INSERT INTO fraud_signals (user_id, trade_id, signal_type, severity, description, auto_action)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, tradeId || null, type, severity, desc, action]
  );
}

// ── Payout hold calculation ──

export function getPayoutHoldDays(trustScore: number): number {
  const tier = [...TRUST_TIERS].reverse().find(t => trustScore >= t.minScore) || TRUST_TIERS[0];
  return tier.payoutHoldDays;
}

export function getTrustTier(trustScore: number) {
  return [...TRUST_TIERS].reverse().find(t => trustScore >= t.minScore) || TRUST_TIERS[0];
}

// ── Reviews ──

export async function submitReview(data: {
  tradeId: string;
  reviewerId: string;
  revieweeId: string;
  role: "buyer" | "seller";
  rating: number;
  cardAccuracy?: number;
  shippingSpeed?: number;
  communication?: number;
  comment?: string;
}): Promise<TradeReview> {
  const result = await query(
    `INSERT INTO trade_reviews (trade_id, reviewer_id, reviewee_id, role, rating, card_accuracy, shipping_speed, communication, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.tradeId, data.reviewerId, data.revieweeId, data.role, data.rating,
     data.cardAccuracy || null, data.shippingSpeed || null,
     data.communication || null, data.comment || null]
  );

  // Recalculate trust score for reviewee
  await calculateTrustScore(data.revieweeId);

  return result.rows[0] as TradeReview;
}

interface TradeReview {
  id: string;
  trade_id: string;
  reviewer_id: string;
  reviewee_id: string;
  role: string;
  rating: number;
}

export async function getUserReviews(userId: string): Promise<TradeReview[]> {
  const result = await query(
    `SELECT r.*, u.name as reviewer_name, o.card_name, t.price as trade_price
     FROM trade_reviews r
     JOIN users u ON r.reviewer_id=u.id
     JOIN market_trades t ON r.trade_id=t.id
     LEFT JOIN market_orders o ON t.bid_order_id=o.id
     WHERE r.reviewee_id=$1 AND r.is_public=true AND r.admin_hidden=false
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return result.rows as TradeReview[];
}

// ── External reputation ──

export async function addExternalRep(userId: string, data: {
  platform: string;
  username: string;
  profileUrl?: string;
  rating?: number;
  totalSales?: number;
  positivePercent?: number;
  memberSince?: string;
  screenshotUrl?: string;
}) {
  await query(
    `INSERT INTO external_reputation (user_id, platform, username, profile_url, rating, total_sales, positive_percent, member_since, screenshot_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, platform) DO UPDATE SET username=$3, profile_url=$4, rating=$5, total_sales=$6, positive_percent=$7, screenshot_url=$9`,
    [userId, data.platform, data.username, data.profileUrl || null,
     data.rating || null, data.totalSales || null, data.positivePercent || null,
     data.memberSince || null, data.screenshotUrl || null]
  );
}

export async function verifyExternalRep(userId: string, platform: string, adminId: string, notes?: string) {
  await query(
    `UPDATE external_reputation SET verified=true, verified_at=NOW(), verified_by=$3, admin_notes=$4
     WHERE user_id=$1 AND platform=$2`,
    [userId, platform, adminId, notes || null]
  );
  await calculateTrustScore(userId);
}

// ── Escrow inspection ──

export async function recordInspection(tradeId: string, data: {
  listedCondition: string;
  actualCondition: string;
  passed: boolean;
  rejectionReason?: string;
  notes?: string;
  photos?: string[];
}) {
  await query(
    `INSERT INTO escrow_inspections (trade_id, listed_condition, actual_condition, condition_match, passed, rejection_reason, inspector_notes, photos, inspected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [tradeId, data.listedCondition, data.actualCondition,
     data.listedCondition === data.actualCondition, data.passed,
     data.rejectionReason || null, data.notes || null,
     JSON.stringify(data.photos || [])]
  );
}

// ── Admin: list fraud signals ──

export async function listFraudSignals(resolved?: boolean): Promise<FraudSignal[]> {
  const params: unknown[] = [];
  let where = "";
  if (resolved !== undefined) {
    params.push(resolved);
    where = `WHERE f.resolved=$1`;
  }

  const result = await query(
    `SELECT f.*, u.name as user_name, u.email as user_email FROM fraud_signals f
     JOIN users u ON f.user_id=u.id ${where} ORDER BY
     CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
     f.created_at DESC`,
    params
  );
  return result.rows as FraudSignal[];
}
