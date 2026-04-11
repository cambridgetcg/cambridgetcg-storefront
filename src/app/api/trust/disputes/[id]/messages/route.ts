import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin/auth";
import { addDisputeMessage, getDisputeMessages } from "@/lib/trust/db";
import { query } from "@/lib/db";

// GET — messages for a dispute
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const messages = await getDisputeMessages(id);
  return NextResponse.json({ messages });
}

// POST — add message
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();

  if (!body.message?.trim()) return NextResponse.json({ error: "Message required." }, { status: 400 });

  // Check if admin
  const admin = await isAdmin();
  if (admin) {
    // Use a system user ID for admin messages
    const adminUser = await query(`SELECT id FROM users LIMIT 1`);
    const senderId = adminUser.rows[0]?.id;
    const msg = await addDisputeMessage(id, senderId, body.message.trim(), true);
    return NextResponse.json({ message: msg });
  }

  // Customer
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Verify user is part of the dispute's trade
  const dispute = await query(
    `SELECT d.trade_id FROM trade_disputes d
     JOIN market_trades t ON d.trade_id=t.id
     WHERE d.id=$1 AND (t.buyer_id=$2 OR t.seller_id=$2)`,
    [id, session.user.id]
  );
  if (dispute.rows.length === 0) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const msg = await addDisputeMessage(id, session.user.id, body.message.trim(), false);
  return NextResponse.json({ message: msg });
}
