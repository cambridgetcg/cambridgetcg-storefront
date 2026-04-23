import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { query } from "@/lib/db";

// Mark a vault redemption fulfilled. Flips vault_items.status → 'redeemed',
// updates the attached customer_order → 'completed', and records tracking
// if provided.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { tracking?: string };
  const tracking = (body.tracking ?? "").trim().slice(0, 200) || null;

  const item = await query(
    `SELECT id, redemption_order_id, status FROM vault_items WHERE id = $1`,
    [id],
  );
  if (item.rows.length === 0) {
    return NextResponse.json({ error: "Vault item not found." }, { status: 404 });
  }
  if (!item.rows[0].redemption_order_id) {
    return NextResponse.json({ error: "Item has no redemption order." }, { status: 409 });
  }
  if (item.rows[0].status !== "reserved") {
    return NextResponse.json({ error: "Item is not in a fulfillable state." }, { status: 409 });
  }

  const orderId: number = item.rows[0].redemption_order_id;

  await query(
    `UPDATE vault_items SET status='redeemed', fulfilled_at=NOW(),
       notes = CASE WHEN $2::text IS NOT NULL THEN 'tracking: ' || $2 ELSE notes END
     WHERE id = $1`,
    [id, tracking],
  );
  await query(
    `UPDATE customer_orders SET status='completed' WHERE id = $1`,
    [orderId],
  );

  return NextResponse.json({ fulfilled: true, vault_item_id: id, order_id: orderId, tracking });
}
