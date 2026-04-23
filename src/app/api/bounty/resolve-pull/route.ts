import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolvePull } from "@/lib/bounty/resolver";
import type { PullTier } from "@/lib/bounty/db";

const VALID_TIERS: PullTier[] = ["common", "uncommon", "rare", "super_rare", "legendary"];

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { tier?: string };
  const tier = body.tier as PullTier | undefined;
  if (!tier || !VALID_TIERS.includes(tier)) {
    return NextResponse.json({ error: "Invalid tier." }, { status: 400 });
  }

  const result = await resolvePull(session.user.id, tier, "user_resolve");

  if ("error" in result) {
    const status =
      result.error === "not_eligible" ? 403
      : result.error === "no_token" ? 409
      : result.error === "tier_disabled" || result.error === "tier_capped" ? 423
      : result.error === "no_stock" ? 503
      : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
