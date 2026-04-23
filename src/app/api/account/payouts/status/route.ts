import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getConnectStatus } from "@/lib/payouts/stripe-connect";
import { query } from "@/lib/db";
import { formatPrice } from "@/lib/format";

// GET — current Connect status + outstanding payouts the seller is owed.
// "Outstanding" = trades/auctions where they're the seller, the lifecycle
// reached the payout-eligible state, and seller_paid_at is still null.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const userId = session.user.id;

  const status = await getConnectStatus(userId);

  // Trades: completed but unpaid
  const trades = await query(
    `SELECT t.id, t.seller_payout, t.created_at,
            COALESCE(o.card_name, t.sku) AS card_name
       FROM market_trades t
       LEFT JOIN market_orders o ON o.id = t.bid_order_id
      WHERE t.seller_id = $1
        AND t.escrow_status = 'completed'
        AND t.seller_paid_at IS NULL
      ORDER BY t.created_at ASC`,
    [userId]
  );

  // Auctions: paid but not yet paid out (consigned only)
  const auctions = await query(
    `SELECT id, title, seller_payout, paid_at
       FROM auctions
      WHERE seller_user_id = $1
        AND status = 'paid'
        AND seller_paid_at IS NULL
        AND seller_payout IS NOT NULL
      ORDER BY paid_at ASC NULLS LAST`,
    [userId]
  );

  const tradeRows = trades.rows.map((r) => ({
    id: r.id,
    label: r.card_name,
    amount: r.seller_payout,
    amountFormatted: formatPrice(parseFloat(r.seller_payout)),
    when: r.created_at,
  }));
  const auctionRows = auctions.rows.map((r) => ({
    id: r.id,
    label: r.title,
    amount: r.seller_payout,
    amountFormatted: formatPrice(parseFloat(r.seller_payout)),
    when: r.paid_at,
  }));

  const totalOwed = [...tradeRows, ...auctionRows]
    .reduce((s, r) => s + parseFloat(r.amount), 0);

  // Liquidity rewards earned to date — store-credit bonuses from resting asks
  const liquidity = await query(
    `SELECT COUNT(*)::int AS award_count,
            COALESCE(SUM(amount_gbp::numeric), 0)::numeric AS total
       FROM liquidity_rewards WHERE user_id = $1`,
    [userId]
  );
  const liqRow = liquidity.rows[0];

  return NextResponse.json({
    status,
    pending: {
      trades: tradeRows,
      auctions: auctionRows,
      totalOwedFormatted: formatPrice(totalOwed),
    },
    liquidity: {
      awardCount: liqRow?.award_count ?? 0,
      totalFormatted: formatPrice(parseFloat(liqRow?.total ?? "0")),
    },
  });
}
