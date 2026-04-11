import { NextResponse } from "next/server";
import Stripe from "stripe";
import { reportSale } from "@/lib/wholesale/client";
import { query } from "@/lib/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    try {
      const skus: { sku: string; qty: number; price_gbp: number; name?: string }[] = session.metadata?.skus
        ? JSON.parse(session.metadata.skus)
        : [];

      // Report sale to wholesale
      if (skus.length > 0) {
        const ok = await reportSale({
          channel: "cambridgetcg.com",
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
      const shipping = session.shipping_details;
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
    } catch (err) {
      console.error("[webhook] Error processing order:", err);
    }
  }

  return NextResponse.json({ received: true });
}
