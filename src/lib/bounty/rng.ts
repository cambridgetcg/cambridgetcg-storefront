// Bounty Pull RNG — commit-reveal for provably fair draws.
//
// Flow per pull:
//   1. Generate a fresh server_seed (32 random bytes).
//   2. Publish commitment = sha256(server_seed) BEFORE the roll.
//   3. Combine server_seed + client_seed + nonce to produce the deterministic
//      roll result.
//   4. Persist server_seed in `bounty_pulls.rng_server_seed` so anyone can
//      verify sha256(revealed_seed) === committed_hash.
//
// client_seed is the user's identifier (user_id) so the same pull can't be
// replayed against another account.

import crypto from "crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function generateServerSeed(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Returns a uniform float in [0, 1) derived deterministically from the seed.
export function rollFloat(serverSeed: string, clientSeed: string, nonce: number): number {
  const combined = `${serverSeed}:${clientSeed}:${nonce}`;
  const hash = sha256(combined);
  // Take the first 13 hex chars (52 bits) — enough precision for weighted draws.
  const slice = hash.slice(0, 13);
  const intValue = parseInt(slice, 16);
  return intValue / 0x10000000000000; // 2^52
}

// Pick a key from `weights` proportional to its value. Weights sum to ~1.0.
export function pickWeighted<T extends string>(
  weights: Record<T, number>,
  roll: number,
): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let cursor = roll * total;
  for (const [key, w] of entries) {
    cursor -= w;
    if (cursor <= 0) return key;
  }
  return entries[entries.length - 1][0];
}
