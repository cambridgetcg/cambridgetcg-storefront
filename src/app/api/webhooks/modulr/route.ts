import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/modulr/client";
import { processIncomingPayment } from "@/lib/modulr/escrow-manager";

// POST — Modulr webhook for incoming payments
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-mod-signature") || "";

  // Verify webhook signature
  if (signature && !verifyWebhookSignature(body, signature)) {
    console.error("[modulr-webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);
    const eventType = payload.type || payload.eventType;

    console.log(`[modulr-webhook] Event: ${eventType}`);

    if (eventType === "PAYMENT_IN" || eventType === "payment.received") {
      const data = payload.data || payload;
      const result = await processIncomingPayment({
        accountNumber: data.accountNumber || data.destination?.accountNumber,
        sortCode: data.sortCode || data.destination?.sortCode,
        amount: parseFloat(data.amount),
        senderName: data.senderName || data.source?.name || "Unknown",
        senderSortCode: data.source?.sortCode,
        senderAccountNumber: data.source?.accountNumber,
        modulrPaymentId: data.id || data.paymentId,
        rawPayload: payload,
      });

      if (result.success) {
        console.log(`[modulr-webhook] Payment received for trade ${result.tradeId}`);
      } else {
        console.warn(`[modulr-webhook] Payment issue: ${result.error}`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[modulr-webhook] Error:", err);
    return NextResponse.json({ received: true }); // Always 200 to prevent retries
  }
}
