import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim(), {
  apiVersion: "2026-02-25.clover",
});
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");

// POST — subscribe to Platinum (monthly or annual)
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await request.json();
  const plan = body.plan; // "monthly" or "annual"

  // Get Platinum tier
  const tierResult = await query(`SELECT * FROM tiers WHERE name='Platinum' AND is_paid=true`);
  if (tierResult.rows.length === 0) return NextResponse.json({ error: "Platinum tier not found." }, { status: 404 });

  const tier = tierResult.rows[0];
  const price = plan === "annual" ? parseFloat(tier.annual_price) : parseFloat(tier.monthly_price);
  const interval = plan === "annual" ? "year" : "month";

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Cambridge TCG Platinum — ${plan === "annual" ? "Annual" : "Monthly"}`,
            description: "Zero fees, 12% store discount, 3x points, 8% cashback, priority everything",
          },
          unit_amount: Math.round(price * 100),
          recurring: { interval: interval as "month" | "year" },
        },
        quantity: 1,
      }],
      success_url: `${SITE_URL}/account/membership?subscribed=true`,
      cancel_url: `${SITE_URL}/account/membership`,
      customer_email: session.user.email || undefined,
      metadata: {
        type: "platinum_subscription",
        user_id: session.user.id,
        tier_id: tier.id,
        plan,
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("[membership] Subscribe error:", err);
    return NextResponse.json({ error: "Failed to create subscription." }, { status: 500 });
  }
}
