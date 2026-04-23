// Bounty Board DB helpers — vault, pull tokens, pulls, eligibility.
// All queries go through `src/lib/db` so the SSL + pooling is shared.

import { query } from "@/lib/db";

// ── Types ──

export type PullTier = "common" | "uncommon" | "rare" | "super_rare" | "legendary";

export interface BountyPullTier {
  tier: PullTier;
  display_name: string;
  target_ev_pence: number;
  weekly_global_cap: number | null;
  rarity_weights: Record<string, number>;
  enabled: boolean;
}

export interface VaultItem {
  id: string;
  user_id: string;
  sku: string;
  card_name: string;
  card_number: string | null;
  set_code: string | null;
  rarity: string | null;
  image_url: string | null;
  spot_price_gbp: string;
  source: string;
  source_reference_id: string | null;
  bounty_pull_id: string | null;
  status: "reserved" | "redeemed" | "sold_back" | "traded" | "gifted" | "expired";
  acquired_at: string;
  expires_at: string;
  p2p_hold_until: string;
  redemption_order_id: number | null;
  fulfilled_at: string | null;
  sold_back_credit: string | null;
  sold_back_at: string | null;
  traded_to_user_id: string | null;
  traded_at: string | null;
  notes: string | null;
}

export interface BountyEligibility {
  user_id: string;
  phone_verified: boolean;
  phone_number: string | null;
  first_order_paid: boolean;
  eligible: boolean;
  reasons: string[];
}

// ── Pull tokens ──

export async function getPullTokens(userId: string): Promise<Record<PullTier, number>> {
  const result = await query(
    `SELECT tier, count FROM bounty_pull_tokens WHERE user_id=$1`,
    [userId],
  );
  const base: Record<PullTier, number> = {
    common: 0, uncommon: 0, rare: 0, super_rare: 0, legendary: 0,
  };
  for (const row of result.rows) {
    if (row.tier in base) base[row.tier as PullTier] = row.count;
  }
  return base;
}

export async function grantPullToken(userId: string, tier: PullTier, count: number = 1): Promise<void> {
  await query(
    `INSERT INTO bounty_pull_tokens (user_id, tier, count, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, tier) DO UPDATE SET
       count = bounty_pull_tokens.count + EXCLUDED.count,
       updated_at = NOW()`,
    [userId, tier, count],
  );
}

// Atomically decrements a pull token if present. Returns true if the caller
// now "holds" the token and may proceed to resolve the pull.
export async function consumePullToken(userId: string, tier: PullTier): Promise<boolean> {
  const result = await query(
    `UPDATE bounty_pull_tokens
     SET count = count - 1, updated_at = NOW()
     WHERE user_id = $1 AND tier = $2 AND count > 0
     RETURNING count`,
    [userId, tier],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function getTierConfig(tier: PullTier): Promise<BountyPullTier | null> {
  const result = await query(
    `SELECT tier, display_name, target_ev_pence, weekly_global_cap, rarity_weights, enabled
     FROM bounty_pull_tiers WHERE tier = $1`,
    [tier],
  );
  return result.rows[0] ?? null;
}

export async function countGlobalPullsThisWeek(tier: PullTier): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS n FROM bounty_pulls
     WHERE tier = $1 AND resolved_at >= NOW() - INTERVAL '7 days'`,
    [tier],
  );
  return result.rows[0]?.n ?? 0;
}

// ── Vault ──

export async function listVault(userId: string, status?: VaultItem["status"]): Promise<VaultItem[]> {
  if (status) {
    const r = await query(
      `SELECT * FROM vault_items WHERE user_id=$1 AND status=$2 ORDER BY acquired_at DESC`,
      [userId, status],
    );
    return r.rows;
  }
  const r = await query(
    `SELECT * FROM vault_items WHERE user_id=$1 ORDER BY acquired_at DESC`,
    [userId],
  );
  return r.rows;
}

export async function getVaultItem(id: string, userId: string): Promise<VaultItem | null> {
  const r = await query(
    `SELECT * FROM vault_items WHERE id=$1 AND user_id=$2`,
    [id, userId],
  );
  return r.rows[0] ?? null;
}

// Count of reserved vault items for a SKU — this is the implicit "reservation"
// against live wholesale stock. Subtract this from wholesale.stock to get
// actual availability for new pulls.
export async function countReservedForSku(sku: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM vault_items WHERE sku=$1 AND status='reserved'`,
    [sku],
  );
  return r.rows[0]?.n ?? 0;
}

export interface CreateVaultItemArgs {
  userId: string;
  sku: string;
  cardName: string;
  cardNumber: string | null;
  setCode: string | null;
  rarity: string | null;
  imageUrl: string | null;
  spotPriceGbp: number;
  source: string;
  sourceReferenceId?: string | null;
  bountyPullId?: string | null;
}

export async function createVaultItem(a: CreateVaultItemArgs): Promise<VaultItem> {
  const r = await query(
    `INSERT INTO vault_items
     (user_id, sku, card_name, card_number, set_code, rarity, image_url,
      spot_price_gbp, source, source_reference_id, bounty_pull_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      a.userId, a.sku, a.cardName, a.cardNumber, a.setCode, a.rarity, a.imageUrl,
      a.spotPriceGbp.toFixed(2), a.source, a.sourceReferenceId ?? null,
      a.bountyPullId ?? null,
    ],
  );
  return r.rows[0];
}

// ── Eligibility ──

export async function getEligibility(userId: string): Promise<BountyEligibility> {
  // Recompute first_order_paid from customer_orders so admins don't need to
  // flip it manually when a purchase completes.
  const paid = await query(
    `SELECT EXISTS (
       SELECT 1 FROM customer_orders
       WHERE user_id = $1 AND status = 'paid'
     ) AS paid`,
    [userId],
  );
  const firstOrderPaid: boolean = paid.rows[0]?.paid ?? false;

  const row = await query(
    `SELECT * FROM user_bounty_eligibility WHERE user_id = $1`,
    [userId],
  );

  const existing = row.rows[0];
  const phoneVerified: boolean = existing?.phone_verified ?? false;
  const phoneNumber: string | null = existing?.phone_number ?? null;

  // Persist any change to first_order_paid (cheap upsert).
  if (!existing || existing.first_order_paid !== firstOrderPaid) {
    await query(
      `INSERT INTO user_bounty_eligibility (user_id, first_order_paid, first_order_paid_at, updated_at)
       VALUES ($1, $2, CASE WHEN $2 THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         first_order_paid = EXCLUDED.first_order_paid,
         first_order_paid_at = COALESCE(user_bounty_eligibility.first_order_paid_at, EXCLUDED.first_order_paid_at),
         updated_at = NOW()`,
      [userId, firstOrderPaid],
    );
  }

  const reasons: string[] = [];
  if (!phoneVerified) reasons.push("phone_not_verified");
  if (!firstOrderPaid) reasons.push("no_paid_order");

  return {
    user_id: userId,
    phone_verified: phoneVerified,
    phone_number: phoneNumber,
    first_order_paid: firstOrderPaid,
    eligible: reasons.length === 0,
    reasons,
  };
}

export async function markPhoneVerified(userId: string, phoneNumber: string): Promise<void> {
  await query(
    `INSERT INTO user_bounty_eligibility (user_id, phone_verified, phone_verified_at, phone_number, updated_at)
     VALUES ($1, true, NOW(), $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       phone_verified = true,
       phone_verified_at = COALESCE(user_bounty_eligibility.phone_verified_at, NOW()),
       phone_number = EXCLUDED.phone_number,
       updated_at = NOW()`,
    [userId, phoneNumber],
  );
}

// ── Sell-back + redemption + pulls ──

export const SELL_BACK_RATE = 0.77;

export async function sellBackVaultItem(itemId: string, userId: string): Promise<{
  item: VaultItem;
  creditAwarded: number;
} | { error: string }> {
  const item = await getVaultItem(itemId, userId);
  if (!item) return { error: "Vault item not found." };
  if (item.status !== "reserved") return { error: "Item cannot be sold back in its current state." };

  const credit = Number((parseFloat(item.spot_price_gbp) * SELL_BACK_RATE).toFixed(2));

  const r = await query(
    `UPDATE vault_items
     SET status='sold_back', sold_back_credit=$2, sold_back_at=NOW()
     WHERE id=$1 AND user_id=$3 AND status='reserved'
     RETURNING *`,
    [itemId, credit.toFixed(2), userId],
  );
  if (r.rowCount === 0) return { error: "Item was no longer reserved (race)." };

  return { item: r.rows[0], creditAwarded: credit };
}

export async function recordBountyPull(args: {
  userId: string;
  tier: PullTier;
  earnedFrom: string;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string;
  nonce: number;
  rolledRarity: string | null;
  rolledSku: string | null;
  rolledSpotGbp: number | null;
  vaultItemId: string | null;
}): Promise<{ id: string }> {
  const r = await query(
    `INSERT INTO bounty_pulls
     (user_id, tier, earned_from, rng_server_seed_hash, rng_server_seed, rng_client_seed, rng_nonce,
      rolled_rarity, rolled_sku, rolled_spot_gbp, vault_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      args.userId, args.tier, args.earnedFrom,
      args.serverSeedHash, args.serverSeed, args.clientSeed, args.nonce,
      args.rolledRarity, args.rolledSku,
      args.rolledSpotGbp != null ? args.rolledSpotGbp.toFixed(2) : null,
      args.vaultItemId,
    ],
  );
  return r.rows[0];
}

export async function linkPullToVaultItem(pullId: string, vaultItemId: string): Promise<void> {
  await query(
    `UPDATE bounty_pulls SET vault_item_id=$2 WHERE id=$1`,
    [pullId, vaultItemId],
  );
}
