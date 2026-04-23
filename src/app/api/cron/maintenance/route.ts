import { NextResponse } from "next/server";
import { runMarketMaintenance } from "@/lib/market/db";
import { runAuctionMaintenance } from "@/lib/auction/db";
import { runBountyExpiry } from "@/lib/bounty/db";

// Vercel cron hits this route on the schedule defined in vercel.json. We
// accept the request only when CRON_SECRET is set and the Bearer token
// matches — Vercel injects this header automatically for project crons.
//
// If CRON_SECRET is not configured (e.g. in local dev) we still allow the
// route to run so it can be exercised manually; production deployments must
// set CRON_SECRET to prevent open invocation.
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const start = Date.now();
  // Run pipelines independently — a failure in one shouldn't block the
  // others. Per-pipeline status is returned so the cron log is debuggable.
  const results = await Promise.allSettled([
    runMarketMaintenance(),
    runAuctionMaintenance(),
    runBountyExpiry(),
  ]);

  const [market, auctions, bounty] = results;

  const status = {
    market: market.status,
    auctions: auctions.status,
    bounty:
      bounty.status === "fulfilled"
        ? { status: "fulfilled", ...bounty.value }
        : { status: "rejected" },
    durationMs: Date.now() - start,
  };

  if (market.status === "rejected") console.error("[cron] market maintenance failed:", market.reason);
  if (auctions.status === "rejected") console.error("[cron] auction maintenance failed:", auctions.reason);
  if (bounty.status === "rejected") console.error("[cron] bounty expiry failed:", bounty.reason);
  else if (bounty.value.expiredCount > 0) {
    console.log(`[cron] bounty: expired ${bounty.value.expiredCount} items, awarded £${bounty.value.creditTotalGbp.toFixed(2)}`);
  }

  return NextResponse.json(status);
}
