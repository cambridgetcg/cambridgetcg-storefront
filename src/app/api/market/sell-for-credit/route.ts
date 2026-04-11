import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchCard } from "@/lib/wholesale/client";
import { addCredit } from "@/lib/membership/db";
import { query } from "@/lib/db";
import { postActivity } from "@/lib/social/db";

// POST — instant sell to CTCG for store credit
// No negotiation, no waiting. CTCG buys at trade-in credit price, always, unlimited.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = await request.json();
  const { sku, quantity } = body;

  if (!sku) return NextResponse.json({ error: "Card SKU required." }, { status: 400 });
  const qty = quantity || 1;
  if (qty < 1 || qty > 99) return NextResponse.json({ error: "Quantity 1-99." }, { status: 400 });

  // Get the trade-in credit price (CTCG's standing bid)
  const card = await fetchCard(sku, "tradein-credit").catch(() => null);
  if (!card || !card.channel_price || card.channel_price <= 0) {
    return NextResponse.json({ error: "This card is not currently on our buy list." }, { status: 400 });
  }

  const creditPerCard = card.channel_price;
  const totalCredit = creditPerCard * qty;
  const cardName = card.name_en || card.name || card.card_number;

  // Create a trade-in submission record for tracking
  const today = new Date();
  const dateStr = today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `CS-${dateStr}-`; // CS = Credit Sell

  const refResult = await query(
    `SELECT reference FROM tradein_submissions WHERE reference LIKE $1 ORDER BY reference DESC LIMIT 1`,
    [prefix + "%"]
  );
  let seq = 1;
  if (refResult.rows.length > 0) {
    seq = parseInt(refResult.rows[0].reference.slice(-4), 10) + 1;
  }
  const reference = prefix + String(seq).padStart(4, "0");

  // Record the submission
  await query(
    `INSERT INTO tradein_submissions (reference, status, customer_name, customer_email, payment_method, delivery_method, is_over_18, quoted_cash_total, quoted_credit_total, quote_expires_at)
     VALUES ($1, 'submitted', $2, $3, 'credit', 'mail', true, '0', $4, NOW() + INTERVAL '7 days')`,
    [reference, session.user.name || "Customer", session.user.email, totalCredit.toFixed(2)]
  );

  const subResult = await query(`SELECT id FROM tradein_submissions WHERE reference=$1`, [reference]);
  const submissionId = subResult.rows[0].id;

  // Record items
  await query(
    `INSERT INTO tradein_items (submission_id, sku, card_number, name, set_code, quantity, quoted_cash_price, quoted_credit_price)
     VALUES ($1, $2, $3, $4, $5, $6, '0', $7)`,
    [submissionId, sku, card.card_number, cardName, card.set_code, qty, creditPerCard.toFixed(2)]
  );

  // Issue credit immediately (pre-authorized — will be clawed back if card not received)
  await addCredit(
    session.user.id,
    totalCredit,
    "tradein_credit",
    `Instant credit sell: ${qty}x ${cardName} @ £${creditPerCard.toFixed(2)} (ref: ${reference})`,
    reference
  );

  // Post activity
  await postActivity(session.user.id, "trade_completed",
    `Sold ${qty}x ${cardName} to CTCG for £${totalCredit.toFixed(2)} credit`,
    { linkUrl: `/trade-in/confirm/${reference}` }
  ).catch(() => {});

  return NextResponse.json({
    reference,
    cardName,
    quantity: qty,
    creditPerCard,
    totalCredit,
    message: `£${totalCredit.toFixed(2)} store credit added to your account. Please send the card(s) to Cambridge TCG within 7 days.`,
  });
}
