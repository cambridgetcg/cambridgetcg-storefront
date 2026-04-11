import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { placeBid, getBidHistory } from "@/lib/auction/db";
import { sendOutbidEmail } from "@/lib/auction/email";
import { query } from "@/lib/db";
import { formatPrice } from "@/lib/format";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bids = await getBidHistory(id);
  return NextResponse.json({ bids });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to place a bid." }, { status: 401 });
  }

  const { id } = await params;
  const { amount } = await request.json();

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "Invalid bid amount." }, { status: 400 });
  }

  try {
    // Get previous high bidder before placing new bid (for outbid notification)
    const prevHigh = await query(
      `SELECT b.user_id, u.email FROM auction_bids b
       JOIN users u ON b.user_id = u.id
       WHERE b.auction_id = $1 AND b.status = 'active'
       ORDER BY b.amount DESC LIMIT 1`,
      [id]
    );

    const result = await placeBid(id, session.user.id, amount);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Send outbid email to previous high bidder (non-blocking)
    if (prevHigh.rows.length > 0 && prevHigh.rows[0].user_id !== session.user.id) {
      const auctionResult = await query(`SELECT title FROM auctions WHERE id = $1`, [id]);
      const title = auctionResult.rows[0]?.title || "Auction";

      sendOutbidEmail({
        email: prevHigh.rows[0].email,
        auctionTitle: title,
        auctionId: id,
        currentPrice: formatPrice(amount),
      }).catch((err) => console.error("[auction] Outbid email failed:", err));
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[auction] Bid error:", err);
    return NextResponse.json({ error: "Failed to place bid." }, { status: 500 });
  }
}
