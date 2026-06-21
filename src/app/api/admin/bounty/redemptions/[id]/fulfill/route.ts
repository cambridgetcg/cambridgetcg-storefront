import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { query } from "@/lib/db";
import { sendVaultRedeemedEmail } from "@/lib/email/bounty";

// Mark a vault redemption fulfilled. Flips vault_items.status → 'redeemed',
// updates the attached customer_order → 'completed', records tracking if
// provided, and fires a shipping notification email to the user.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { tracking?: string };
  const tracking = (body.tracking ?? "").trim().slice(0, 200) || null;

  // Pull the full item + order + user info in one round trip so the email
  // template has everything it needs.
  const item = await query(
    `SELECT v.id, v.user_id, v.redemption_order_id, v.status, v.card_name,
            v.card_number, v.rarity, v.image_url, v.acquired_at,
            co.shipping_name, co.shipping_address
     FROM vault_items v
     LEFT JOIN customer_orders co ON co.id = v.redemption_order_id
     WHERE v.id = $1`,
    [id],
  );
  if (item.rows.length === 0) {
    return NextResponse.json({ error: "Vault item not found." }, { status: 404 });
  }
  const v = item.rows[0];
  if (!v.redemption_order_id) {
    return NextResponse.json({ error: "Item has no redemption order." }, { status: 409 });
  }
  if (v.status !== "reserved") {
    return NextResponse.json({ error: "Item is not in a fulfillable state." }, { status: 409 });
  }

  const orderId: number = v.redemption_order_id;

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

  // Fire-and-forget the shipping notification.
  void sendVaultRedeemedEmail({
    userId: v.user_id,
    cardName: v.card_name,
    cardNumber: v.card_number,
    rarity: v.rarity,
    imageUrl: v.image_url,
    shippingName: v.shipping_name ?? "",
    shippingAddress: v.shipping_address ?? "",
    orderId,
    tracking,
    acquiredAt: new Date(v.acquired_at),
  }).catch((err) => console.error("[bounty] vault-redeemed email failed:", err));

  return NextResponse.json({ fulfilled: true, vault_item_id: id, order_id: orderId, tracking });
}
