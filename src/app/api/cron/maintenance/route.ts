import { NextResponse } from "next/server";
import { runMarketMaintenance } from "@/lib/market/db";
import { runAuctionMaintenance } from "@/lib/auction/db";
import { runBountyExpiry } from "@/lib/bounty/db";
import { runPayoutSweep } from "@/lib/payouts/sweep";
import { runAlertSweep } from "@/lib/market/watches";
import { drainEmailQueue } from "@/lib/email/queue";
import { runStreakAtRiskSweep } from "@/lib/email/streak-sweep";

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
  // Streak sweep runs once per UTC day (20:00) — cheap guard so every
  // minute doesn't re-run it. scheduleEmail() is idempotent by key, so
  // even a double-trigger would be harmless, but we skip the SELECT.
  const now = new Date();
  const runStreakSweep =
    now.getUTCHours() === 20 && now.getUTCMinutes() < 2;

  const results = await Promise.allSettled([
    runMarketMaintenance(),
    runAuctionMaintenance(),
    runBountyExpiry(),
    runPayoutSweep(),
    runAlertSweep(),
    drainEmailQueue({ limit: 100 }),
    runStreakSweep ? runStreakAtRiskSweep() : Promise.resolve(null),
  ]);

  const [market, auctions, bounty, payouts, alerts, emails, streakSweep] = results;

  const status = {
    market: market.status,
    auctions: auctions.status,
    bounty:
      bounty.status === "fulfilled"
        ? { status: "fulfilled", ...bounty.value }
        : { status: "rejected" },
    payouts:
      payouts.status === "fulfilled"
        ? { status: "fulfilled", ...payouts.value }
        : { status: "rejected" },
    alerts:
      alerts.status === "fulfilled"
        ? { status: "fulfilled", ...alerts.value }
        : { status: "rejected" },
    emails:
      emails.status === "fulfilled"
        ? { status: "fulfilled", ...emails.value }
        : { status: "rejected" },
    streakSweep:
      streakSweep.status === "fulfilled" && streakSweep.value != null
        ? { status: "fulfilled", ...streakSweep.value }
        : streakSweep.status === "rejected"
          ? { status: "rejected" }
          : { status: "skipped" },
    durationMs: Date.now() - start,
  };

  if (market.status === "rejected") console.error("[cron] market maintenance failed:", market.reason);
  if (auctions.status === "rejected") console.error("[cron] auction maintenance failed:", auctions.reason);
  if (bounty.status === "rejected") console.error("[cron] bounty expiry failed:", bounty.reason);
  else if (bounty.value.expiredCount > 0) {
    console.log(`[cron] bounty: expired ${bounty.value.expiredCount} items, awarded £${bounty.value.creditTotalGbp.toFixed(2)}`);
  }
  if (payouts.status === "rejected") console.error("[cron] payout sweep failed:", payouts.reason);
  else if (payouts.value.tradesPaid + payouts.value.auctionsPaid > 0 ||
           payouts.value.tradeFailures.length + payouts.value.auctionFailures.length > 0) {
    console.log(
      `[cron] payouts: ${payouts.value.tradesPaid} trades + ${payouts.value.auctionsPaid} auctions paid; ` +
      `${payouts.value.tradeFailures.length + payouts.value.auctionFailures.length} failed` +
      (payouts.value.throttled ? " (throttled)" : "")
    );
    for (const f of [...payouts.value.tradeFailures, ...payouts.value.auctionFailures]) {
      console.error(`[cron] payout failure ${f.id}: ${f.error}`);
    }
  }
  if (alerts.status === "rejected") console.error("[cron] alert sweep failed:", alerts.reason);
  else if (alerts.value.fired > 0 || alerts.value.failures > 0) {
    console.log(
      `[cron] alerts: ${alerts.value.fired} fired, ${alerts.value.failures} failed` +
      (alerts.value.throttled ? " (throttled)" : "")
    );
  }
  if (emails.status === "rejected") console.error("[cron] email drain failed:", emails.reason);
  else if (emails.value.picked > 0) {
    console.log(
      `[cron] emails: picked ${emails.value.picked}, ` +
      `sent ${emails.value.sent}, cancelled ${emails.value.cancelled}, ` +
      `failed ${emails.value.failed}, dead ${emails.value.dead}`,
    );
    for (const e of emails.value.errors) {
      console.error(`[cron] email queue error ${e.id} (${e.event}): ${e.error}`);
    }
  }
  if (streakSweep.status === "rejected") console.error("[cron] streak sweep failed:", streakSweep.reason);
  else if (streakSweep.value != null && streakSweep.value.atRiskCount > 0) {
    console.log(
      `[cron] streak sweep: ${streakSweep.value.atRiskCount} at-risk, ` +
      `${streakSweep.value.queuedCount} queued, ${streakSweep.value.errors} errors`,
    );
  }

  return NextResponse.json(status);
}
