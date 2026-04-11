import { NextResponse } from "next/server";
import { processIncomingPayment } from "@/lib/modulr/escrow-manager";

// POST — Mangopay webhook handler
// Mangopay sends: { EventType, RessourceId, Date }
// Verification: fetch resource by ID via API (not HMAC)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const eventType = body.EventType || body.type;
    const resourceId = body.RessourceId || body.ResourceId;

    console.log(`[mangopay-webhook] ${eventType} | ${resourceId}`);

    if (eventType === "PAYIN_NORMAL_SUCCEEDED" && resourceId) {
      const result = await processIncomingPayment({
        modulrPaymentId: resourceId,
        amount: 0,
        senderName: "Buyer",
        rawPayload: body,
      });
      console.log(`[mangopay-webhook] Pay-in: ${result.success ? "OK" : result.error} trade=${result.tradeId}`);
    }

    if (eventType === "PAYIN_NORMAL_FAILED") {
      console.error(`[mangopay-webhook] Pay-in FAILED: ${resourceId}`);
    }

    if (eventType === "PAYOUT_NORMAL_SUCCEEDED") {
      console.log(`[mangopay-webhook] Payout OK: ${resourceId}`);
    }

    if (eventType === "PAYOUT_NORMAL_FAILED") {
      console.error(`[mangopay-webhook] Payout FAILED: ${resourceId}`);
    }

    if (eventType === "KYC_SUCCEEDED") {
      console.log(`[mangopay-webhook] KYC validated: ${resourceId}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[mangopay-webhook] Error:", err);
    return NextResponse.json({ received: true });
  }
}
