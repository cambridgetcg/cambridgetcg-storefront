import { NextResponse } from "next/server";
import { runMarketMaintenance } from "@/lib/market/db";
import { runAuctionMaintenance } from "@/lib/auction/db";
import { runBountyExpiry } from "@/lib/bounty/db";
import { runPayoutSweep } from "@/lib/payouts/sweep";
import { runAlertSweep } from "@/lib/market/watches";
import { drainEmailQueue } from "@/lib/email/queue";
import { runStreakAtRiskSweep } from "@/lib/email/streak-sweep";
import { sendAdminWeeklyDigest } from "@/lib/email/admin-digest";
import { runSellerRestockDigest, runBuyerWatchlistDigest } from "@/lib/market/digests";
import { runLiquidityMining } from "@/lib/market/liquidity";
import { runTradeinSweep } from "@/lib/tradein/sweep";
import { runPriceHistoryTick } from "@/lib/portfolio/price-history";
import { runAnnualSpendRecompute } from "@/lib/membership/spend-sweep";

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
  // Admin digest — Monday 09:00 UTC, one 2-minute window. Doesn't use the
  // email_queue; sends synchronously via SES.
  const runDigest =
    now.getUTCDay() === 1 && now.getUTCHours() === 9 && now.getUTCMinutes() < 2;
  // Price history tick — once per UTC day (03:00), avoids hitting the
  // wholesale API more than needed. runPriceHistoryTick is internally
  // idempotent-per-day so over-triggering is harmless.
  const runPriceTick =
    now.getUTCHours() === 3 && now.getUTCMinutes() < 2;

  const results = await Promise.allSettled([
    runMarketMaintenance(),
    runAuctionMaintenance(),
    runBountyExpiry(),
    runPayoutSweep(),
    runAlertSweep(),
    drainEmailQueue({ limit: 100 }),
    runStreakSweep ? runStreakAtRiskSweep() : Promise.resolve(null),
    // Weekly digests — self-gate to Monday 09:00 UTC + atomic digest_runs claim.
    runSellerRestockDigest(),
    runBuyerWatchlistDigest(),
    runDigest ? sendAdminWeeklyDigest() : Promise.resolve(null),
    // Liquidity mining — idempotent per (order, UTC day), safe every minute
    runLiquidityMining(),
    // Trade-in: expire quotes past their 24h response window + email
    runTradeinSweep(),
    // Portfolio price-history sampler
    runPriceTick ? runPriceHistoryTick() : Promise.resolve(null),
    // Annual spend recompute — self-gates to 02:00 UTC daily
    runAnnualSpendRecompute(),
  ]);

  const [market, auctions, bounty, payouts, alerts, emails, streakSweep, restockDigest, watchlistDigest, adminDigest, liquidity, tradeinSweep, priceTick, spendRecompute] = results;

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
    restockDigest:
      restockDigest.status === "fulfilled"
        ? (restockDigest.value.skipped ? { status: "skipped" } : { status: "fulfilled", sent: restockDigest.value.sent })
        : { status: "rejected" },
    watchlistDigest:
      watchlistDigest.status === "fulfilled"
        ? (watchlistDigest.value.skipped ? { status: "skipped" } : { status: "fulfilled", sent: watchlistDigest.value.sent })
        : { status: "rejected" },
    adminDigest:
      adminDigest.status === "fulfilled" && adminDigest.value != null
        ? { status: "fulfilled", sent: adminDigest.value.ok, error: adminDigest.value.ok ? null : adminDigest.value.error }
        : adminDigest.status === "rejected"
          ? { status: "rejected" }
          : { status: "skipped" },
    liquidity:
      liquidity.status === "fulfilled"
        ? { status: "fulfilled", ...liquidity.value }
        : { status: "rejected" },
    tradeinSweep:
      tradeinSweep.status === "fulfilled"
        ? { status: "fulfilled", ...tradeinSweep.value }
        : { status: "rejected" },
    priceTick:
      priceTick.status === "fulfilled" && priceTick.value != null
        ? { status: "fulfilled", ...priceTick.value }
        : priceTick.status === "rejected"
          ? { status: "rejected" }
          : { status: "skipped" },
    spendRecompute:
      spendRecompute.status === "fulfilled"
        ? (spendRecompute.value.ranInWindow
            ? { status: "fulfilled", ...spendRecompute.value }
            : { status: "skipped" })
        : { status: "rejected" },
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
  if (restockDigest.status === "rejected") console.error("[cron] restock digest failed:", restockDigest.reason);
  else if (!restockDigest.value.skipped) {
    console.log(`[cron] restock digest: sent ${restockDigest.value.sent}`);
  }
  if (watchlistDigest.status === "rejected") console.error("[cron] watchlist digest failed:", watchlistDigest.reason);
  else if (!watchlistDigest.value.skipped) {
    console.log(`[cron] watchlist digest: sent ${watchlistDigest.value.sent}`);
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
  if (liquidity.status === "rejected") console.error("[cron] liquidity mining failed:", liquidity.reason);
  else if (liquidity.value.awards > 0) {
    console.log(
      `[cron] liquidity: ${liquidity.value.awards} awards, £${liquidity.value.amountGbp.toFixed(2)} credit` +
      (liquidity.value.throttled ? " (throttled)" : "")
    );
  }
  if (tradeinSweep.status === "rejected") console.error("[cron] tradein sweep failed:", tradeinSweep.reason);
  else if (tradeinSweep.value.expired > 0) {
    console.log(
      `[cron] tradein: expired ${tradeinSweep.value.expired} quote(s), ` +
      `${tradeinSweep.value.emailsSent} emails sent, ${tradeinSweep.value.emailsFailed} failed`
    );
  }
  if (spendRecompute.status === "rejected") console.error("[cron] spend recompute failed:", spendRecompute.reason);
  else if (spendRecompute.value.ranInWindow) {
    console.log(
      `[cron] spend recompute: ${spendRecompute.value.recomputed} users, ` +
      `${spendRecompute.value.tierChanges} tier changes, ${spendRecompute.value.failures} failures`
    );
  }

  return NextResponse.json(status);
}
