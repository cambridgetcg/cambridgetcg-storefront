import { query } from "@/lib/db";
import type { UserVerification, TradeDispute, DisputeMessage, DisputeEvidence, EscrowPayment } from "./types";

// ══════════════════════════════════════════════════════════════
// VERIFICATION
// ══════════════════════════════════════════════════════════════

export async function submitVerification(userId: string, data: {
  fullLegalName: string;
  dateOfBirth: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  county?: string;
  postcode: string;
  phone?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
}): Promise<UserVerification> {
  const result = await query(
    `INSERT INTO user_verifications (user_id, full_legal_name, date_of_birth,
      address_line1, address_line2, city, county, postcode, country,
      phone, bank_sort_code, bank_account_number, bank_account_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'GB',$9,$10,$11,$12)
     ON CONFLICT (user_id) DO UPDATE SET
       full_legal_name=$2, date_of_birth=$3, address_line1=$4, address_line2=$5,
       city=$6, county=$7, postcode=$8, phone=$9, bank_sort_code=$10,
       bank_account_number=$11, bank_account_name=$12,
       status='pending', updated_at=NOW()
     RETURNING *`,
    [userId, data.fullLegalName, data.dateOfBirth, data.addressLine1,
     data.addressLine2 || null, data.city, data.county || null, data.postcode.toUpperCase().trim(),
     data.phone || null, data.bankSortCode || null,
     data.bankAccountNumber || null, data.bankAccountName || null]
  );
  return result.rows[0] as UserVerification;
}

export async function getVerification(userId: string): Promise<UserVerification | null> {
  const result = await query(`SELECT * FROM user_verifications WHERE user_id = $1`, [userId]);
  return result.rows[0] as UserVerification ?? null;
}

export async function isUserVerified(userId: string): Promise<boolean> {
  const result = await query(`SELECT is_verified FROM users WHERE id = $1`, [userId]);
  return result.rows[0]?.is_verified === true;
}

export async function approveVerification(userId: string, notes?: string): Promise<void> {
  await query(
    `UPDATE user_verifications SET status='verified', verified_at=NOW(), admin_notes=$2, updated_at=NOW() WHERE user_id=$1`,
    [userId, notes || null]
  );
  await query(`UPDATE users SET is_verified=true, country='GB' WHERE id=$1`, [userId]);
}

export async function rejectVerification(userId: string, reason: string): Promise<void> {
  await query(
    `UPDATE user_verifications SET status='rejected', rejected_reason=$2, updated_at=NOW() WHERE user_id=$1`,
    [userId, reason]
  );
}

export async function listPendingVerifications(): Promise<(UserVerification & { email: string })[]> {
  const result = await query(
    `SELECT v.*, u.email FROM user_verifications v JOIN users u ON v.user_id=u.id
     WHERE v.status='pending' ORDER BY v.created_at ASC`
  );
  return result.rows as (UserVerification & { email: string })[];
}

export async function listAllVerifications(): Promise<(UserVerification & { email: string })[]> {
  const result = await query(
    `SELECT v.*, u.email FROM user_verifications v JOIN users u ON v.user_id=u.id
     ORDER BY v.created_at DESC`
  );
  return result.rows as (UserVerification & { email: string })[];
}

// ══════════════════════════════════════════════════════════════
// DISPUTES
// ══════════════════════════════════════════════════════════════

export async function raiseDispute(tradeId: string, userId: string, reason: string, description: string): Promise<TradeDispute> {
  // Persist the reason on the trade row (separate from escrow_status, which
  // is set by updateEscrowStatus below — that path also sends both parties
  // the "dispute opened" email via the market email module).
  await query(
    `UPDATE market_trades SET dispute_reason=$2, updated_at=NOW() WHERE id=$1`,
    [tradeId, reason]
  );

  const result = await query(
    `INSERT INTO trade_disputes (trade_id, raised_by, reason, description) VALUES ($1,$2,$3,$4) RETURNING *`,
    [tradeId, userId, reason, description]
  );

  // Cascade to the trade lifecycle (and trigger emails) via the market layer.
  // Imported lazily to avoid a static cross-module cycle if the market db
  // ever needs to call into trust.
  const { updateEscrowStatus } = await import("@/lib/market/db");
  await updateEscrowStatus(tradeId, "disputed", {
    adminNotes: `Dispute raised: ${reason}`,
  });

  return result.rows[0] as TradeDispute;
}

export async function getDispute(disputeId: string): Promise<TradeDispute | null> {
  const result = await query(
    `SELECT d.*, u.name as raiser_name, u.email as raiser_email,
       t.price as trade_price, bu.name as buyer_name, su.name as seller_name,
       o.card_name
     FROM trade_disputes d
     JOIN users u ON d.raised_by=u.id
     JOIN market_trades t ON d.trade_id=t.id
     JOIN users bu ON t.buyer_id=bu.id
     JOIN users su ON t.seller_id=su.id
     LEFT JOIN market_orders o ON t.bid_order_id=o.id
     WHERE d.id=$1`,
    [disputeId]
  );
  return result.rows[0] as TradeDispute ?? null;
}

export async function getDisputeByTrade(tradeId: string): Promise<TradeDispute | null> {
  const result = await query(
    `SELECT d.*, u.name as raiser_name, u.email as raiser_email
     FROM trade_disputes d JOIN users u ON d.raised_by=u.id
     WHERE d.trade_id=$1 ORDER BY d.created_at DESC LIMIT 1`,
    [tradeId]
  );
  return result.rows[0] as TradeDispute ?? null;
}

export async function listDisputes(status?: string): Promise<TradeDispute[]> {
  const params: unknown[] = [];
  let where = "";
  if (status) { params.push(status); where = `WHERE d.status=$1`; }

  const result = await query(
    `SELECT d.*, u.name as raiser_name, u.email as raiser_email,
       t.price as trade_price, bu.name as buyer_name, su.name as seller_name,
       o.card_name
     FROM trade_disputes d
     JOIN users u ON d.raised_by=u.id
     JOIN market_trades t ON d.trade_id=t.id
     JOIN users bu ON t.buyer_id=bu.id
     JOIN users su ON t.seller_id=su.id
     LEFT JOIN market_orders o ON t.bid_order_id=o.id
     ${where} ORDER BY d.created_at DESC`,
    params
  );
  return result.rows as TradeDispute[];
}

export async function resolveDispute(disputeId: string, data: {
  resolutionType: "refund_buyer" | "release_seller" | "split" | "return_card";
  resolutionNotes: string;
  refundAmount?: number;
}): Promise<TradeDispute> {
  const statusMap: Record<string, string> = {
    refund_buyer: "resolved_buyer",
    release_seller: "resolved_seller",
    split: "resolved_split",
    return_card: "resolved_buyer",
  };

  const result = await query(
    `UPDATE trade_disputes SET status=$2, resolution_type=$3, resolution_notes=$4,
     refund_amount=$5, resolved_at=NOW(), resolved_by_admin=true, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [disputeId, statusMap[data.resolutionType], data.resolutionType,
     data.resolutionNotes, data.refundAmount?.toFixed(2) ?? null]
  );
  const dispute = result.rows[0] as TradeDispute;

  // Cascade onto the trade: refund_buyer / split → refunded, others → completed.
  // updateEscrowStatus also fires the resolution emails to both parties.
  const tradeStatus =
    data.resolutionType === "refund_buyer" || data.resolutionType === "split"
      ? "refunded"
      : "completed";
  const { updateEscrowStatus } = await import("@/lib/market/db");
  await updateEscrowStatus(dispute.trade_id, tradeStatus, {
    adminNotes: `Dispute resolved (${data.resolutionType}): ${data.resolutionNotes}`,
  });

  return dispute;
}

export async function addDisputeMessage(disputeId: string, senderId: string, message: string, isAdmin: boolean): Promise<DisputeMessage> {
  const result = await query(
    `INSERT INTO dispute_messages (dispute_id, sender_id, is_admin, message) VALUES ($1,$2,$3,$4) RETURNING *`,
    [disputeId, senderId, isAdmin, message]
  );
  return result.rows[0] as DisputeMessage;
}

export async function getDisputeMessages(disputeId: string): Promise<DisputeMessage[]> {
  const result = await query(
    `SELECT m.*, u.name as sender_name FROM dispute_messages m
     JOIN users u ON m.sender_id=u.id WHERE m.dispute_id=$1 ORDER BY m.created_at ASC`,
    [disputeId]
  );
  return result.rows as DisputeMessage[];
}

export async function getDisputeEvidence(disputeId: string): Promise<DisputeEvidence[]> {
  const result = await query(
    `SELECT * FROM dispute_evidence WHERE dispute_id=$1 ORDER BY created_at ASC`,
    [disputeId]
  );
  return result.rows as DisputeEvidence[];
}

export async function addDisputeEvidence(disputeId: string, userId: string, url: string, s3Key: string, label?: string): Promise<DisputeEvidence> {
  const result = await query(
    `INSERT INTO dispute_evidence (dispute_id, uploaded_by, url, s3_key, label) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [disputeId, userId, url, s3Key, label || null]
  );
  return result.rows[0] as DisputeEvidence;
}

// ══════════════════════════════════════════════════════════════
// ESCROW PAYMENTS
// ══════════════════════════════════════════════════════════════

export async function createEscrowPayment(tradeId: string, amount: number, stripeSessionId: string): Promise<EscrowPayment> {
  const result = await query(
    `INSERT INTO escrow_payments (trade_id, type, stripe_checkout_session, amount, status)
     VALUES ($1,'buyer_payment',$2,$3,'pending') RETURNING *`,
    [tradeId, stripeSessionId, amount.toFixed(2)]
  );
  return result.rows[0] as EscrowPayment;
}

export async function markEscrowPaid(tradeId: string, stripePaymentIntent: string): Promise<void> {
  await query(
    `UPDATE escrow_payments SET status='paid', stripe_payment_intent=$2, paid_at=NOW()
     WHERE trade_id=$1 AND type='buyer_payment'`,
    [tradeId, stripePaymentIntent]
  );
  await query(
    `UPDATE market_trades SET escrow_status='paid', buyer_paid_at=NOW(), stripe_payment_intent=$2, updated_at=NOW()
     WHERE id=$1`,
    [tradeId, stripePaymentIntent]
  );
}

export async function recordSellerPayout(tradeId: string, amount: number, reference: string): Promise<void> {
  await query(
    `INSERT INTO escrow_payments (trade_id, type, amount, status, payout_amount, payout_reference, payout_at)
     VALUES ($1,'seller_payout',$2,'completed',$2,$3,NOW())`,
    [tradeId, amount.toFixed(2), reference]
  );
}

export async function recordRefund(tradeId: string, amount: number, reason: string): Promise<void> {
  await query(
    `UPDATE escrow_payments SET refund_amount=$2, refund_reason=$3, refunded_at=NOW(), status='refunded'
     WHERE trade_id=$1 AND type='buyer_payment'`,
    [tradeId, amount.toFixed(2), reason]
  );
  await query(
    `UPDATE market_trades SET escrow_status='refunded', updated_at=NOW() WHERE id=$1`,
    [tradeId]
  );
}

export async function getEscrowPayments(tradeId: string): Promise<EscrowPayment[]> {
  const result = await query(
    `SELECT * FROM escrow_payments WHERE trade_id=$1 ORDER BY created_at ASC`,
    [tradeId]
  );
  return result.rows as EscrowPayment[];
}
