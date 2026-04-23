// Resolve a Bounty Pull end-to-end.
// 1. Consume a pull token
// 2. Commit-reveal RNG to pick a rarity per tier weights
// 3. Fetch live wholesale catalog, filter by rolled rarity + in-stock,
//    subtract implicit vault reservations, pick one via RNG
// 4. Persist bounty_pulls + vault_items atomically-enough (individual queries;
//    the token consumption is the only row-level race protection we need —
//    everything after is derived)
//
// Returns a minimal result object suitable for the API response.

import { fetchPrices } from "@/lib/wholesale/client";
import { retailPrice } from "@/lib/pricing";
import {
  consumePullToken,
  countReservedForSku,
  createVaultItem,
  getTierConfig,
  recordBountyPull,
  linkPullToVaultItem,
  getEligibility,
  countGlobalPullsThisWeek,
  type PullTier,
  type VaultItem,
} from "./db";
import { sha256, generateServerSeed, rollFloat, pickWeighted } from "./rng";

export interface PullResolution {
  pull_id: string;
  vault_item: VaultItem;
  rolled_rarity: string;
  rarity_weights: Record<string, number>;
  rng_commitment: string;
  rng_server_seed: string;
  rng_client_seed: string;
  rng_nonce: number;
}

export type PullError =
  | { error: "no_token"; message: string }
  | { error: "tier_disabled"; message: string }
  | { error: "tier_capped"; message: string }
  | { error: "not_eligible"; message: string; reasons: string[] }
  | { error: "no_stock"; message: string }
  | { error: "internal"; message: string };

export async function resolvePull(
  userId: string,
  tier: PullTier,
  earnedFrom: string,
): Promise<PullResolution | PullError> {
  // 1) Eligibility
  const elig = await getEligibility(userId);
  if (!elig.eligible) {
    return {
      error: "not_eligible",
      message: "Bounty Board requires a verified phone and a prior paid order.",
      reasons: elig.reasons,
    };
  }

  // 2) Tier config + global cap
  const cfg = await getTierConfig(tier);
  if (!cfg) return { error: "internal", message: "Tier not configured." };
  if (!cfg.enabled) {
    return { error: "tier_disabled", message: `${cfg.display_name} is currently disabled.` };
  }
  if (cfg.weekly_global_cap != null) {
    const used = await countGlobalPullsThisWeek(tier);
    if (used >= cfg.weekly_global_cap) {
      return {
        error: "tier_capped",
        message: `${cfg.display_name} has hit its weekly global cap. Try again next week.`,
      };
    }
  }

  // 3) Consume token (race-safe)
  const ok = await consumePullToken(userId, tier);
  if (!ok) {
    return { error: "no_token", message: `You don't have a ${cfg.display_name}.` };
  }

  // 4) RNG: commit-reveal, roll a rarity
  const serverSeed = generateServerSeed();
  const commitment = sha256(serverSeed);
  const clientSeed = userId;
  const nonce = Date.now();
  const rarityRoll = rollFloat(serverSeed, clientSeed, nonce);
  const rolledRarity = pickWeighted(cfg.rarity_weights, rarityRoll);

  // 5) Find candidate SKUs — fetch wholesale, filter locally
  const catalog = await fetchPrices({
    game: "one-piece",
    in_stock: true,
    limit: 200,
  });

  const candidates = catalog.items.filter(
    (c) =>
      (c.rarity ?? "").toUpperCase() === rolledRarity.toUpperCase()
      && c.stock > 0
      && c.name != null,
  );

  // Exclude SKUs whose implicit reservation equals/exceeds live stock
  const available: typeof candidates = [];
  for (const c of candidates) {
    const reserved = await countReservedForSku(c.sku);
    if (c.stock - reserved > 0) available.push(c);
  }

  if (available.length === 0) {
    // Refund the token — we failed to fulfil through no fault of the user
    await import("./db").then((m) => m.grantPullToken(userId, tier, 1));
    // Still record a pull audit for transparency, without a vault item
    await recordBountyPull({
      userId, tier, earnedFrom,
      serverSeedHash: commitment,
      serverSeed, clientSeed, nonce,
      rolledRarity, rolledSku: null, rolledSpotGbp: null,
      vaultItemId: null,
    });
    return {
      error: "no_stock",
      message: `No ${rolledRarity} cards are currently available. Your token was refunded.`,
    };
  }

  // 6) Pick a candidate from the available pool via a second RNG draw
  const pickRoll = rollFloat(serverSeed, clientSeed, nonce + 1);
  const picked = available[Math.floor(pickRoll * available.length)];
  const spot = retailPrice(picked.price_gbp, picked.channel_price);

  // 7) Write pull log first (so vault_item can reference it), then vault item,
  //    then backfill the pull's vault_item_id.
  const pull = await recordBountyPull({
    userId, tier, earnedFrom,
    serverSeedHash: commitment,
    serverSeed, clientSeed, nonce,
    rolledRarity, rolledSku: picked.sku, rolledSpotGbp: spot,
    vaultItemId: null,
  });

  const vault = await createVaultItem({
    userId,
    sku: picked.sku,
    cardName: picked.name ?? picked.sku,
    cardNumber: picked.card_number,
    setCode: picked.set_code,
    rarity: picked.rarity,
    imageUrl: picked.image_url,
    spotPriceGbp: spot,
    source: earnedFrom,
    bountyPullId: pull.id,
  });

  await linkPullToVaultItem(pull.id, vault.id);

  return {
    pull_id: pull.id,
    vault_item: vault,
    rolled_rarity: rolledRarity,
    rarity_weights: cfg.rarity_weights,
    rng_commitment: commitment,
    rng_server_seed: serverSeed,
    rng_client_seed: clientSeed,
    rng_nonce: nonce,
  };
}
