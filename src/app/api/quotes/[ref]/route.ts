import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { getQuoteByRef, getQuoteDetail, setItemPrices, sendOffer, respondToOffer } from "@/lib/quote/db";
import { sendQuoteOfferEmail, sendQuoteAcceptedAdminNotification } from "@/lib/quote/email";
import { query } from "@/lib/db";

// GET — public: view quote by reference
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const quote = await getQuoteByRef(ref);
  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }
  return NextResponse.json(quote);
}

// PATCH — admin: set prices and send offer, or update status
export async function PATCH(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ref } = await params;
  const body = await request.json();

  // Look up request by reference
  const result = await query(`SELECT * FROM quote_requests WHERE reference = $1`, [ref]);
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }
  const request_row = result.rows[0];

  // Action: set prices and send offer
  if (body.action === "send_offer") {
    if (!body.items || !Array.isArray(body.items)) {
      return NextResponse.json({ error: "Items with prices required." }, { status: 400 });
    }

    await setItemPrices(body.items);
    const updated = await sendOffer(request_row.id, body.adminNotes);

    // Send email
    sendQuoteOfferEmail({
      reference: ref,
      customerName: updated.customer_name,
      customerEmail: updated.customer_email,
      total: parseFloat(updated.quoted_total || "0"),
      paymentMethod: updated.payment_method,
      expiresAt: updated.offer_expires_at || "",
    }).catch((e) => console.error("[quote] Offer email failed:", e));

    return NextResponse.json({ request: updated });
  }

  // Action: cancel
  if (body.action === "cancel") {
    const updated = await query(
      `UPDATE quote_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [request_row.id]
    );
    return NextResponse.json({ request: updated.rows[0] });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

// POST — public: customer accepts or declines offer
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const body = await request.json();

  if (!["accept", "decline"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const updated = await respondToOffer(ref, body.action === "accept");
  if (!updated) {
    return NextResponse.json({ error: "Quote not found or already responded." }, { status: 404 });
  }

  if (body.action === "accept") {
    sendQuoteAcceptedAdminNotification({
      reference: ref,
      customerName: updated.customer_name,
      total: parseFloat(updated.quoted_total || "0"),
    }).catch((e) => console.error("[quote] Accept email failed:", e));
  }

  return NextResponse.json({ request: updated });
}
