import { NextResponse } from "next/server";
import Stripe from "stripe";
import { reportSale } from "@/lib/wholesale/client";

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
      const skus: { sku: string; qty: number; price_gbp: number }[] = session.metadata?.skus
        ? JSON.parse(session.metadata.skus)
        : [];

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
    } catch (err) {
      console.error("[webhook] Error processing order:", err);
    }
  }

  return NextResponse.json({ received: true });
}
