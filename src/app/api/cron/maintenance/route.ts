import { NextResponse } from "next/server";
import { runMarketMaintenance } from "@/lib/market/db";
import { runAuctionMaintenance } from "@/lib/auction/db";

// Vercel cron hits this route on the schedule defined in vercel.ts. We accept
// the request only when CRON_SECRET is set and the Bearer token matches —
// Vercel injects this header automatically for project crons.
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
  // Run both pipelines independently — a failure in one shouldn't block the
  // other. We return per-pipeline status so the cron log is debuggable.
  const results = await Promise.allSettled([
    runMarketMaintenance(),
    runAuctionMaintenance(),
  ]);

  const status = {
    market: results[0].status,
    auctions: results[1].status,
    durationMs: Date.now() - start,
  };

  if (results[0].status === "rejected") console.error("[cron] market maintenance failed:", results[0].reason);
  if (results[1].status === "rejected") console.error("[cron] auction maintenance failed:", results[1].reason);

  return NextResponse.json(status);
}
