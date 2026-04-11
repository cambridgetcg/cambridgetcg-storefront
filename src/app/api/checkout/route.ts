import { NextResponse } from "next/server";
import Stripe from "stripe";
import type { CartItem } from "@/lib/cart";
import { auth } from "@/lib/auth";
import { getUserPerks } from "@/lib/membership/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim(), {
  apiVersion: "2026-02-25.clover",
});

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items: CartItem[] = body.items;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    for (const item of items) {
      if (!item.sku || !item.price || item.price <= 0 || !item.quantity || item.quantity <= 0) {
        return NextResponse.json({ error: "Invalid item in cart" }, { status: 400 });
      }
    }

    // Check for Platinum store discount
    let discountPercent = 0;
    const session_auth = await auth();
    if (session_auth?.user?.id) {
      const perks = await getUserPerks(session_auth.user.id);
      discountPercent = perks.store_discount_percent;
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
      success_url: `${SITE_URL}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout`,
      customer_email: session_auth?.user?.email || undefined,
      shipping_address_collection: {
        allowed_countries: ["GB", "US", "CA", "AU", "DE", "FR", "NL", "JP"],
      },
      metadata: {
        skus: JSON.stringify(items.map((i) => ({ sku: i.sku, qty: i.quantity, price_gbp: i.price, name: i.name }))),
        ...(discountPercent > 0 ? { platinum_discount: String(discountPercent) } : {}),
      },
    });

    return NextResponse.json({ url: session.url, discount: discountPercent });
  } catch (err) {
    console.error("[checkout] Error creating session:", err);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
