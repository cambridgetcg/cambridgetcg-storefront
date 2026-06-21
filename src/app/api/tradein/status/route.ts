import { NextResponse } from "next/server";
import { getSubmission, getSubmissionByRef } from "@/lib/tradein/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref");
  const email = url.searchParams.get("email");

  if (!ref) {
    return NextResponse.json({ error: "Reference number is required." }, { status: 400 });
  }

  try {
    let result;

    if (email) {
      result = await getSubmission(ref, email);
    } else {
      // Allow lookup by ref only (for confirmation page)
      result = await getSubmissionByRef(ref);
    }

    if (!result) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    const { submission, items } = result;

    return NextResponse.json({
      reference: submission.reference,
      status: submission.status,
      paymentMethod: submission.payment_method,
      deliveryMethod: submission.delivery_method,
      cashTotal: parseFloat(submission.quoted_cash_total || "0"),
      creditTotal: parseFloat(submission.quoted_credit_total || "0"),
      expiresAt: submission.quote_expires_at,
      createdAt: submission.created_at,
      items: items.map((i) => ({
        sku: i.sku,
        game: i.game || "one-piece",
        name: i.name || i.sku,
        card_number: i.card_number || "",
        quantity: i.quantity,
        cash_price: parseFloat(i.quoted_cash_price || "0"),
        credit_price: parseFloat(i.quoted_credit_price || "0"),
      })),
    });
  } catch (err) {
    console.error("[tradein] Status lookup error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
