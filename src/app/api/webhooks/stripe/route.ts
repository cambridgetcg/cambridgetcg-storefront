import { NextResponse } from "next/server";
import Stripe from "stripe";
import { reportSale } from "@/lib/wholesale/client";
import { query } from "@/lib/db";
import { processOrderRewards } from "@/lib/membership/db";
import { postActivity, awardAchievement } from "@/lib/social/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim(), {
  apiVersion: "2026-02-25.clover",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!.trim();

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Subscription renewal — fires monthly/annually when Stripe collects the
  // recurring charge for a Platinum subscriber. Extends subscription_expires_at
  // so recalculateTier() keeps the user on Platinum.
  if (event.type === "invoice.payment_succeeded") {
    try {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string };
      const subId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription
            ? (invoice.subscription as { id?: string }).id ?? null
            : null;
      // Skip the first invoice — that's the initial checkout; the
      // checkout.session.completed handler already stamped expires_at.
      // Renewal invoices have billing_reason='subscription_cycle'.
      if (subId && invoice.billing_reason === "subscription_cycle") {
        // Period covered by this invoice tells us the new expiry. Stripe
        // gives us period_end on the line item.
        const periodEnd = invoice.lines.data[0]?.period?.end;
        if (periodEnd) {
          await query(
            `UPDATE users
                SET subscription_expires_at = to_timestamp($2),
                    subscription_status = 'active',
                    tier_calculated_at = NOW(),
                    updated_at = NOW()
              WHERE subscription_stripe_id = $1`,
            [subId, periodEnd]
          );
          // Recalc tier to honour the freshly extended subscription
          const u = await query(
            `SELECT id FROM users WHERE subscription_stripe_id = $1`,
            [subId]
          );
          if (u.rows[0]) {
            const { recalculateTier } = await import("@/lib/membership/db");
            await recalculateTier(u.rows[0].id).catch(() => {});
          }
          console.log(`[webhook] Platinum renewal: subscription ${subId} extended`);
        }
      }
    } catch (err) {
      console.error("[webhook] invoice.payment_succeeded error:", err);
    }
    return NextResponse.json({ received: true });
  }

  // Subscription cancelled / lapsed — flip status, let recalculateTier drop
  // the user to their best spending-based tier on next profile fetch.
  if (event.type === "customer.subscription.deleted") {
    try {
      const sub = event.data.object as Stripe.Subscription;
      await query(
        `UPDATE users
            SET subscription_status = 'cancelled',
                tier_calculated_at = NOW(),
                updated_at = NOW()
          WHERE subscription_stripe_id = $1`,
        [sub.id]
      );
      const u = await query(
        `SELECT id FROM users WHERE subscription_stripe_id = $1`,
        [sub.id]
      );
      if (u.rows[0]) {
        const { recalculateTier } = await import("@/lib/membership/db");
        await recalculateTier(u.rows[0].id).catch(() => {});
      }
      console.log(`[webhook] Platinum subscription ${sub.id} cancelled`);
    } catch (err) {
      console.error("[webhook] subscription.deleted error:", err);
    }
    return NextResponse.json({ received: true });
  }

  // Stripe Connect: keep the local account state in sync with Stripe's view.
  // Fires when a seller completes onboarding, has a requirement come due,
  // or gets restricted/disabled.
  if (event.type === "account.updated") {
    try {
      const account = event.data.object as Stripe.Account;
      const { syncAccountFromStripe } = await import("@/lib/payouts/stripe-connect");
      await syncAccountFromStripe(account.id);
      console.log(`[webhook] Connect account ${account.id} synced (charges=${account.charges_enabled} payouts=${account.payouts_enabled})`);
    } catch (err) {
      console.error("[webhook] account.updated sync failed:", err);
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    try {
      const skus: { sku: string; qty: number; price_gbp: number; name?: string }[] = session.metadata?.skus
        ? JSON.parse(session.metadata.skus)
        : [];

      // Report sale to wholesale
      if (skus.length > 0) {
        const ok = await reportSale({
          channel: "cambridgetcg",
          order_ref: session.id,
          items: skus.map((s) => ({
            sku: s.sku,
            qty: s.qty,
            price_gbp: s.price_gbp,
          })),
        });

        console.log(
          `[webhook] Order ${session.id} — reportSale ${ok ? "succeeded" : "failed"}`,
          { skus }
        );
      }

      // Record order in customer_orders
      const email = session.customer_details?.email || session.customer_email || "";
      const name = session.customer_details?.name || "";
      const total = (session.amount_total || 0) / 100;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shipping = (session as any).shipping_details;
      const shippingAddr = shipping?.address
        ? [shipping.address.line1, shipping.address.line2, shipping.address.city, shipping.address.postal_code, shipping.address.country]
            .filter(Boolean)
            .join(", ")
        : null;

      // Try to find matching user
      let userId = null;
      if (email) {
        const userResult = await query(
          `SELECT id FROM users WHERE email = $1`,
          [email.toLowerCase()]
        );
        if (userResult.rows.length > 0) {
          userId = userResult.rows[0].id;
        }
      }

      await query(
        `INSERT INTO customer_orders
          (user_id, stripe_session_id, stripe_payment_intent, customer_email, customer_name,
           status, total_gbp, currency, shipping_name, shipping_address, items)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (stripe_session_id) DO NOTHING`,
        [
          userId,
          session.id,
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
          email.toLowerCase(),
          name,
          "completed",
          total.toFixed(2),
          session.currency || "gbp",
          shipping?.name || name,
          shippingAddr,
          JSON.stringify(skus),
        ]
      );

      console.log(`[webhook] Order ${session.id} recorded for ${email}`);

      // Social: activity feed + achievement
      if (userId) {
        postActivity(userId, "card_added", "Purchased cards from the store").catch(() => {});
        awardAchievement(userId, "first_purchase").catch(() => {});
      }

      // Debit applied store credit. The amount is in metadata (set by
      // /api/checkout) so we don't have to round-trip. Atomic via a
      // single UPDATE that refuses to go negative; if balance changed
      // mid-flight (concurrent debits, manual adjustments), the user
      // sees a partial debit and a ledger entry reflects what was
      // actually subtracted.
      const creditAppliedGbp = session.metadata?.credit_applied_gbp
        ? parseFloat(session.metadata.credit_applied_gbp)
        : 0;
      const creditUserId = session.metadata?.credit_user_id || userId;
      if (creditUserId && creditAppliedGbp > 0) {
        try {
          const debitRes = await query(
            `UPDATE users
                SET store_credit_balance = GREATEST(0, store_credit_balance - $2),
                    updated_at = NOW()
              WHERE id = $1
              RETURNING store_credit_balance::numeric AS balance`,
            [creditUserId, creditAppliedGbp.toFixed(2)]
          );
          if (debitRes.rows[0]) {
            await query(
              `INSERT INTO store_credit_ledger (user_id, amount, balance, type, description, reference_id)
               VALUES ($1, $2, $3, 'redeemed_checkout', $4, $5)`,
              [creditUserId, (-creditAppliedGbp).toFixed(2), debitRes.rows[0].balance,
               `Applied at checkout`, session.id]
            );
            console.log(`[webhook] Credit redeemed: £${creditAppliedGbp.toFixed(2)} for ${creditUserId}`);
          }
        } catch (creditErr) {
          console.error("[webhook] Credit debit failed:", creditErr);
        }
      }

      // Process membership rewards (points + cashback). `total` is the cash
      // amount Stripe actually collected — i.e. cart subtotal minus credit
      // and minus tier discount. So rewards naturally apply to "cash spent",
      // matching the marketing promise.
      if (userId && total > 0) {
        try {
          const rewards = await processOrderRewards(userId, total, session.id);
          console.log(`[webhook] Rewards: ${rewards.pointsEarned} points, £${rewards.cashbackAmount} cashback for ${email}`);
        } catch (rewardErr) {
          console.error("[webhook] Rewards processing failed (order still recorded):", rewardErr);
        }
      }
    } catch (err) {
      console.error("[webhook] Error processing order:", err);
    }

    // Handle Platinum subscription
    if (session.metadata?.type === "platinum_subscription" && session.metadata?.user_id) {
      try {
        const subUserId = session.metadata.user_id;
        const tierId = session.metadata.tier_id;
        const plan = session.metadata.plan;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.toString() || session.id;

        // Set expiry based on plan
        const expiresAt = new Date();
        if (plan === "annual") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        else expiresAt.setMonth(expiresAt.getMonth() + 1);

        await query(
          `UPDATE users SET paid_tier_id=$2, tier_id=$2, subscription_status='active',
           subscription_stripe_id=$3, subscription_expires_at=$4,
           tier_source='subscription', tier_calculated_at=NOW(), updated_at=NOW()
           WHERE id=$1`,
          [subUserId, tierId, subId, expiresAt.toISOString()]
        );
        console.log(`[webhook] Platinum activated for user ${subUserId} (${plan})`);
      } catch (err) {
        console.error("[webhook] Platinum subscription error:", err);
      }
    }

    // Handle P2P market trade payments. Move the trade past awaiting_payment
    // and notify both parties. Tier decides whether the seller ships to the
    // buyer (direct/verified) or to CTCG (full_escrow); the email tells them.
    if (session.metadata?.type === "market_trade_payment" && session.metadata?.trade_id) {
      try {
        const tradeId = session.metadata.trade_id;
        // 'awaiting_shipment' if seller ships to buyer, 'paid' if shipping to CTCG
        // (admin will then mark received_by_ctcg). We default to awaiting_shipment
        // since the seller's next action is "ship", regardless of destination.
        const upd = await query(
          `UPDATE market_trades
              SET escrow_status = 'awaiting_shipment',
                  buyer_paid_at = NOW(),
                  stripe_session_id = $2,
                  stripe_payment_intent = $3,
                  updated_at = NOW()
            WHERE id = $1 AND escrow_status = 'awaiting_payment'
            RETURNING *`,
          [
            tradeId,
            session.id,
            typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
          ]
        );

        if (upd.rows.length > 0) {
          const trade = upd.rows[0];
          // Look up emails + card name and fire paid notifications
          const info = await query(
            `SELECT bu.email AS buyer_email, su.email AS seller_email,
                    COALESCE(o.card_name, t.sku) AS card_name
               FROM market_trades t
               JOIN users bu ON bu.id = t.buyer_id
               JOIN users su ON su.id = t.seller_id
               LEFT JOIN market_orders o ON o.id = t.bid_order_id
              WHERE t.id = $1`,
            [tradeId]
          );
          if (info.rows.length > 0) {
            const { sendBuyerPaidEmail, sendSellerPaidEmail } = await import("@/lib/market/email");
            const { formatPrice } = await import("@/lib/format");
            const r = info.rows[0];
            const total = parseFloat(trade.price) * trade.quantity;
            const tier = trade.escrow_tier || "full_escrow";
            sendBuyerPaidEmail({
              email: r.buyer_email,
              cardName: r.card_name,
              price: formatPrice(total),
              tier,
            }).catch((e) => console.error("[webhook] Buyer paid email failed:", e));
            sendSellerPaidEmail({
              email: r.seller_email,
              cardName: r.card_name,
              price: formatPrice(total),
              tier,
              shipsTo: trade.seller_ships_to || "ctcg",
              payout: formatPrice(parseFloat(trade.seller_payout)),
            }).catch((e) => console.error("[webhook] Seller paid email failed:", e));
          }
        }
        console.log(`[webhook] Market trade ${tradeId} marked paid`);
      } catch (err) {
        console.error("[webhook] Error processing market trade payment:", err);
      }
    }

    // Handle lot purchases (market_lot_payment)
    if (session.metadata?.type === "market_lot_payment" && session.metadata?.lot_trade_id) {
      try {
        const { markLotTradePaid } = await import("@/lib/market/lots");
        const tradeId = session.metadata.lot_trade_id;
        const paymentIntent =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || null;
        await markLotTradePaid(tradeId, session.id, paymentIntent);
        console.log(`[webhook] Lot trade ${tradeId} marked paid`);
      } catch (err) {
        console.error("[webhook] Error processing lot payment:", err);
      }
    }

    // Handle auction payments
    if (session.metadata?.type === "auction_payment" && session.metadata?.auction_id) {
      try {
        const auctionId = session.metadata.auction_id;
        await query(
          `UPDATE auctions SET status = 'paid', stripe_session_id = $2,
           stripe_payment_intent = $3, paid_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'ended'`,
          [
            auctionId,
            session.id,
            typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
          ]
        );
        console.log(`[webhook] Auction ${auctionId} marked as paid`);
      } catch (err) {
        console.error("[webhook] Error processing auction payment:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
