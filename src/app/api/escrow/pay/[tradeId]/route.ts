import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin/auth";
import { createEscrowForTrade, getEscrowDetails, payoutSeller, refundBuyer } from "@/lib/modulr/escrow-manager";
import { query } from "@/lib/db";

// GET — get escrow payment details for a trade (buyer sees bank details)
export async function GET(_req: Request, { params }: { params: Promise<{ tradeId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { tradeId } = await params;

  // Verify user is part of this trade
  const trade = await query(
    `SELECT * FROM market_trades WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)`,
    [tradeId, session.user.id]
  );
  if (trade.rows.length === 0) return NextResponse.json({ error: "Trade not found." }, { status: 404 });

  const escrow = await getEscrowDetails(tradeId);
  if (!escrow) return NextResponse.json({ error: "No escrow account for this trade." }, { status: 404 });

  // Only show full bank details to buyer
  const isBuyer = trade.rows[0].buyer_id === session.user.id;

  return NextResponse.json({
    escrow: {
      status: escrow.status,
      reference: escrow.reference,
      expectedAmount: escrow.expected_amount,
      expiresAt: escrow.expires_at,
      receivedAmount: escrow.received_amount,
      receivedAt: escrow.received_at,
      payoutSentAt: escrow.payout_sent_at,
      // Bank details only for buyer
      ...(isBuyer ? {
        sortCode: escrow.sort_code,
        accountNumber: escrow.account_number,
        accountName: escrow.account_name,
      } : {}),
    },
    isBuyer,
  });
}

// POST — create escrow account for trade (auto on match) or admin actions
export async function POST(request: Request, { params }: { params: Promise<{ tradeId: string }> }) {
  const { tradeId } = await params;
  const body = await request.json();

  // Admin: payout or refund
  if (body.action === "payout") {
    if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await payoutSeller(tradeId);
    return NextResponse.json(result);
  }

  if (body.action === "refund") {
    if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const success = await refundBuyer(tradeId, body.reason || "Admin refund");
    return NextResponse.json({ success });
  }

  // Create escrow (buyer or system)
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const escrow = await createEscrowForTrade(tradeId);
  if (!escrow) return NextResponse.json({ error: "Failed to create escrow." }, { status: 500 });

  return NextResponse.json({ escrow });
}
