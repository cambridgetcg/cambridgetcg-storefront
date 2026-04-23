// Pull-token merge — burn N same-tier tokens, receive 1 next-tier token.
//
// Chain: common → uncommon → rare → super_rare.
// super_rare and legendary cannot be auto-merged to because the legendary
// tier has a tight global weekly cap; auto-minting into it would bypass
// the supply control. Admin can grant legendary tokens directly if needed.
//
// Atomicity is guaranteed by the CHECK (count >= 0) constraint on
// bounty_pull_tokens combined with a WHERE count >= COST predicate on
// the decrement: either the decrement succeeds (we owe the caller a
// new token) or it leaves the row untouched. The grant + audit insert
// run independently; a crash between them would leave the user with
// the cost already paid and no token yet — but those scenarios require
// process death mid-request and are detectable post-hoc from the
// bounty_merges audit table (no row → user didn't get their token →
// admin refund).

import { query } from "@/lib/db";
import type { PullTier } from "./db";

export const MERGE_COST = 4;

/** Which tier you get when you merge N same-tier tokens. null = not mergeable. */
export const MERGE_CHAIN: Record<PullTier, PullTier | null> = {
  common: "uncommon",
  uncommon: "rare",
  rare: "super_rare",
  super_rare: null,
  legendary: null,
};

export function canMerge(tier: PullTier): boolean {
  return MERGE_CHAIN[tier] !== null;
}

export type MergeResult =
  | { ok: true; fromTier: PullTier; toTier: PullTier; consumed: number }
  | { ok: false; error: "not_mergeable" | "insufficient_tokens" | "tier_disabled"; message: string };

export async function mergeTokens(userId: string, fromTier: PullTier): Promise<MergeResult> {
  const toTier = MERGE_CHAIN[fromTier];
  if (!toTier) {
    return {
      ok: false,
      error: "not_mergeable",
      message: `${fromTier} tokens cannot be merged further.`,
    };
  }

  // Refuse to mint into a tier that admin has disabled. The user's existing
  // tokens at toTier are preserved; we just don't create new ones against
  // a disabled ladder.
  const cfg = await query(
    `SELECT enabled FROM bounty_pull_tiers WHERE tier = $1`,
    [toTier],
  );
  if (cfg.rows[0]?.enabled === false) {
    return {
      ok: false,
      error: "tier_disabled",
      message: `The ${toTier} tier is currently disabled. Try again later.`,
    };
  }

  // Atomic decrement — succeeds only if the user has ≥ MERGE_COST tokens
  // of the from tier.
  const dec = await query(
    `UPDATE bounty_pull_tokens
     SET count = count - $3, updated_at = NOW()
     WHERE user_id = $1 AND tier = $2 AND count >= $3
     RETURNING count`,
    [userId, fromTier, MERGE_COST],
  );

  if (dec.rowCount === 0) {
    return {
      ok: false,
      error: "insufficient_tokens",
      message: `You need at least ${MERGE_COST} ${fromTier} tokens to merge.`,
    };
  }

  // Grant the new token (upsert).
  await query(
    `INSERT INTO bounty_pull_tokens (user_id, tier, count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (user_id, tier) DO UPDATE SET
       count = bounty_pull_tokens.count + 1,
       updated_at = NOW()`,
    [userId, toTier],
  );

  // Audit row for lineage / stats.
  await query(
    `INSERT INTO bounty_merges (user_id, from_tier, to_tier, tokens_consumed)
     VALUES ($1, $2, $3, $4)`,
    [userId, fromTier, toTier, MERGE_COST],
  );

  return { ok: true, fromTier, toTier, consumed: MERGE_COST };
}

/** How many merges a user has done, total + by-tier. */
export async function getMergeStats(userId: string): Promise<{
  total: number;
  byFromTier: Record<string, number>;
}> {
  const rows = await query(
    `SELECT from_tier, COUNT(*)::int AS n
     FROM bounty_merges WHERE user_id = $1
     GROUP BY from_tier`,
    [userId],
  );
  let total = 0;
  const byFromTier: Record<string, number> = {};
  for (const r of rows.rows) {
    byFromTier[r.from_tier] = r.n;
    total += r.n;
  }
  return { total, byFromTier };
}
