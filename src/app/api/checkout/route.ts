import { NextResponse } from "next/server";
import Stripe from "stripe";
import type { CartItem } from "@/lib/cart";
import { auth } from "@/lib/auth";
import { getUserPerks } from "@/lib/membership/db";
import { query } from "@/lib/db";
import { fetchCard } from "@/lib/wholesale/client";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim(), {
  apiVersion: "2026-02-25.clover",
});

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items: CartItem[] = body.items;
    const requestedCreditGbp = typeof body.creditToApply === "number" ? body.creditToApply : 0;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    for (const item of items) {
      if (!item.sku || !item.price || item.price <= 0 || !item.quantity || item.quantity <= 0) {
        return NextResponse.json({ error: "Invalid item in cart" }, { status: 400 });
      }
    }

    // Stock guard — verify availability before any Stripe work so we
    // never sell what the wholesale side can't fulfil.
    for (const item of items) {
      const card = await fetchCard(item.sku);
      const available = card?.stock ?? 0;
      if (!card || available < item.quantity) {
        return NextResponse.json(
          { error: "insufficient_stock", sku: item.sku, available },
          { status: 409 }
        );
      }
    }

    // Tier discount + credit balance — perks gives the discount, balance
    // comes from the users row directly.
    let discountPercent = 0;
    let availableCreditGbp = 0;
    const session_auth = await auth();
    if (session_auth?.user?.id) {
      const perks = await getUserPerks(session_auth.user.id);
      discountPercent = perks.store_discount_percent;
      const balRes = await query(
        `SELECT store_credit_balance::numeric AS bal FROM users WHERE id = $1`,
        [session_auth.user.id]
      );
      availableCreditGbp = parseFloat(balRes.rows[0]?.bal ?? "0");
    }

    // Cart subtotal AFTER tier discount but BEFORE credit, in pence
    const subtotalPence = items.reduce((sum, item) => {
      const unitPence = discountPercent > 0
        ? Math.round(item.price * (1 - discountPercent / 100) * 100)
        : Math.round(item.price * 100);
      return sum + unitPence * item.quantity;
    }, 0);

    // Apply credit, capped by: requested amount, current balance, and
    // subtotal-1p (Stripe rejects zero-total checkouts).
    let appliedCreditPence = 0;
    let couponId: string | null = null;
    if (requestedCreditGbp > 0 && session_auth?.user?.id) {
      appliedCreditPence = Math.min(
        Math.floor(requestedCreditGbp * 100),
        Math.floor(availableCreditGbp * 100),
        Math.max(subtotalPence - 1, 0)
      );
      if (appliedCreditPence > 0) {
        // One-shot coupon. Webhook debits the user's ledger by this amount
        // on checkout.session.completed; abandoned coupons are harmless.
        const coupon = await stripe.coupons.create({
          amount_off: appliedCreditPence,
          currency: "gbp",
          duration: "once",
          name: `Store credit (£${(appliedCreditPence / 100).toFixed(2)})`,
        });
        couponId = coupon.id;
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: items.map((item) => {
        const discountedPrice = discountPercent > 0
          ? Math.round(item.price * (1 - discountPercent / 100) * 100)
          : Math.round(item.price * 100);

        return {
          price_data: {
            currency: "gbp",
            product_data: {
              name: discountPercent > 0
                ? `${item.name} (${discountPercent}% Platinum discount)`
                : item.name,
              ...(item.image_url ? { images: [item.image_url] } : {}),
              metadata: { sku: item.sku, card_number: item.card_number },
            },
            unit_amount: discountedPrice,
          },
          quantity: item.quantity,
        };
      }),
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      success_url: `${SITE_URL}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout`,
      customer_email: session_auth?.user?.email || undefined,
      shipping_address_collection: {
        allowed_countries: ["GB", "US", "CA", "AU", "DE", "FR", "NL", "JP"],
      },
      metadata: {
        skus: JSON.stringify(items.map((i) => ({ sku: i.sku, qty: i.quantity, price_gbp: i.price, name: i.name }))),
        ...(discountPercent > 0 ? { platinum_discount: String(discountPercent) } : {}),
        ...(appliedCreditPence > 0 && session_auth?.user?.id ? {
          credit_applied_gbp: (appliedCreditPence / 100).toFixed(2),
          credit_user_id: session_auth.user.id,
        } : {}),
      },
    });

    return NextResponse.json({
      url: session.url,
      discount: discountPercent,
      creditApplied: appliedCreditPence / 100,
      creditAvailable: availableCreditGbp,
    });
  } catch (err) {
    console.error("[checkout] Error creating session:", err);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
