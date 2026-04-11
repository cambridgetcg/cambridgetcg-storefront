// Escrow Manager — orchestrates the full P2P payment lifecycle via Modulr
//
// 1. Trade matched → create virtual account → show buyer bank details
// 2. Buyer pays via bank transfer → webhook confirms receipt
// 3. Trade completes → CoP check seller → pay seller → close account

import { query } from "@/lib/db";
import { createVirtualAccount, sendPayment, checkCoP, closeAccount, isConfigured } from "./client";
import crypto from "crypto";

// ── Generate unique trade reference ──

function generateReference(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "CTCG-";
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

// ── Create escrow for a matched trade ──

export async function createEscrowForTrade(tradeId: string): Promise<{
  sortCode: string;
  accountNumber: string;
  accountName: string;
  reference: string;
  amount: number;
  expiresAt: string;
} | null> {
  // Get trade details
  const tradeResult = await query(
    `SELECT t.*, bu.name as buyer_name, bu.email as buyer_email,
       su.name as seller_name, o.card_name
     FROM market_trades t
     JOIN users bu ON t.buyer_id=bu.id
     JOIN users su ON t.seller_id=su.id
     LEFT JOIN market_orders o ON t.bid_order_id=o.id
     WHERE t.id=$1`,
    [tradeId]
  );

  if (tradeResult.rows.length === 0) return null;
  const trade = tradeResult.rows[0];
  const amount = parseFloat(trade.price) * trade.quantity;
  const reference = generateReference();
  const accountName = `CTCG Escrow ${reference}`;

  // Expires in 24 hours
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  let sortCode = "04-00-75"; // Modulr sort code (placeholder)
  let accountNumber = crypto.randomBytes(4).toString("hex").substring(0, 8);
  let modulrAccountId = null;

  // Create virtual account via Modulr if configured
  if (isConfigured()) {
    try {
      const account = await createVirtualAccount(accountName, tradeId);
      sortCode = account.sortCode;
      accountNumber = account.accountNumber;
      modulrAccountId = account.id;
    } catch (err) {
      console.error("[escrow] Modulr account creation failed, using fallback:", err);
    }
  }

  // Record escrow account
  await query(
    `INSERT INTO escrow_accounts (trade_id, modulr_account_id, sort_code, account_number,
      account_name, reference, expected_amount, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (trade_id) DO UPDATE SET
       sort_code=$3, account_number=$4, reference=$6, expected_amount=$7, expires_at=$8, updated_at=NOW()`,
    [tradeId, modulrAccountId, sortCode, accountNumber, accountName, reference, amount.toFixed(2), expiresAt.toISOString()]
  );

  // Update trade status
  await query(
    `UPDATE market_trades SET escrow_status='awaiting_payment', updated_at=NOW() WHERE id=$1`,
    [tradeId]
  );

  return { sortCode, accountNumber, accountName, reference, amount, expiresAt: expiresAt.toISOString() };
}

// ── Process incoming payment (called from webhook) ──

export async function processIncomingPayment(data: {
  accountNumber: string;
  sortCode: string;
  amount: number;
  senderName: string;
  senderSortCode?: string;
  senderAccountNumber?: string;
  modulrPaymentId?: string;
  rawPayload?: object;
}): Promise<{ tradeId: string | null; success: boolean; error?: string }> {
  // Find the escrow account by account number
  const escrow = await query(
    `SELECT * FROM escrow_accounts WHERE account_number=$1 AND status='awaiting_payment'`,
    [data.accountNumber]
  );

  if (escrow.rows.length === 0) {
    // Log unmatched payment
    await query(
      `INSERT INTO payment_events (event_type, amount, sender_name, sender_sort_code, sender_account_number, status, raw_payload)
       VALUES ('unmatched_payment', $1, $2, $3, $4, 'unmatched', $5)`,
      [data.amount, data.senderName, data.senderSortCode || null, data.senderAccountNumber || null, JSON.stringify(data.rawPayload || {})]
    );
    return { tradeId: null, success: false, error: "No matching escrow account" };
  }

  const account = escrow.rows[0];
  const expectedAmount = parseFloat(account.expected_amount);

  // Log the payment event
  await query(
    `INSERT INTO payment_events (escrow_account_id, trade_id, event_type, modulr_payment_id, amount, sender_name, sender_sort_code, sender_account_number, status, raw_payload)
     VALUES ($1, $2, 'payment_received', $3, $4, $5, $6, $7, 'received', $8)`,
    [account.id, account.trade_id, data.modulrPaymentId || null, data.amount,
     data.senderName, data.senderSortCode || null, data.senderAccountNumber || null,
     JSON.stringify(data.rawPayload || {})]
  );

  // Check amount matches
  if (Math.abs(data.amount - expectedAmount) > 0.01) {
    await query(
      `UPDATE escrow_accounts SET status='amount_mismatch', received_amount=$2, sender_name=$3, received_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [account.id, data.amount, data.senderName]
    );
    return { tradeId: account.trade_id, success: false, error: `Expected £${expectedAmount.toFixed(2)}, received £${data.amount.toFixed(2)}` };
  }

  // CoP check on incoming payment (verify buyer's name)
  let copResult = "NOT_CHECKED";
  let copMatch = null;
  if (isConfigured() && data.senderSortCode && data.senderAccountNumber) {
    try {
      const cop = await checkCoP(data.senderSortCode, data.senderAccountNumber, data.senderName);
      copResult = cop.result;
      copMatch = cop.result === "MATCH";

      await query(
        `INSERT INTO cop_checks (trade_id, direction, sort_code, account_number, name_checked, result, response_name)
         VALUES ($1, 'inbound', $2, $3, $4, $5, $6)`,
        [account.trade_id, data.senderSortCode, data.senderAccountNumber, data.senderName, cop.result, cop.matchedName || null]
      );
    } catch {
      copResult = "ERROR";
    }
  }

  // Mark payment received
  await query(
    `UPDATE escrow_accounts SET status='payment_received', received_amount=$2, received_at=NOW(),
     sender_name=$3, sender_sort_code=$4, sender_account_number=$5,
     cop_inbound_result=$6, cop_inbound_name_match=$7, updated_at=NOW()
     WHERE id=$1`,
    [account.id, data.amount, data.senderName, data.senderSortCode || null,
     data.senderAccountNumber || null, copResult, copMatch]
  );

  // Update trade status
  await query(
    `UPDATE market_trades SET escrow_status='paid', buyer_paid_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [account.trade_id]
  );

  return { tradeId: account.trade_id, success: true };
}

// ── Pay out seller on trade completion ──

export async function payoutSeller(tradeId: string): Promise<{
  success: boolean;
  amount?: number;
  copResult?: string;
  error?: string;
}> {
  const escrow = await query(`SELECT * FROM escrow_accounts WHERE trade_id=$1`, [tradeId]);
  if (escrow.rows.length === 0) return { success: false, error: "No escrow account" };

  const account = escrow.rows[0];
  if (account.status !== "payment_received" && account.status !== "payout_pending") {
    return { success: false, error: `Invalid escrow status: ${account.status}` };
  }

  // Get seller's bank details
  const trade = await query(
    `SELECT t.*, v.bank_sort_code, v.bank_account_number, v.bank_account_name, v.full_legal_name
     FROM market_trades t
     LEFT JOIN user_verifications v ON t.seller_id=v.user_id
     WHERE t.id=$1`,
    [tradeId]
  );

  if (trade.rows.length === 0) return { success: false, error: "Trade not found" };
  const t = trade.rows[0];

  if (!t.bank_sort_code || !t.bank_account_number) {
    return { success: false, error: "Seller bank details not provided" };
  }

  const payoutAmount = parseFloat(t.seller_payout);
  const commissionAmount = parseFloat(t.commission_amount);
  const payoutRef = `CTCG-${account.reference}-PAY`;

  // CoP check on seller's account before sending
  let copResult = "NOT_CHECKED";
  let copMatch = null;
  if (isConfigured()) {
    try {
      const sellerName = t.bank_account_name || t.full_legal_name || "";
      const cop = await checkCoP(t.bank_sort_code, t.bank_account_number, sellerName);
      copResult = cop.result;
      copMatch = cop.result === "MATCH";

      await query(
        `INSERT INTO cop_checks (user_id, trade_id, direction, sort_code, account_number, name_checked, result, response_name)
         VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7)`,
        [t.seller_id, tradeId, t.bank_sort_code, t.bank_account_number,
         sellerName, cop.result, cop.matchedName || null]
      );

      // Block payout if name doesn't match
      if (cop.result === "NO_MATCH") {
        await query(
          `UPDATE escrow_accounts SET cop_outbound_result=$2, cop_outbound_name_match=false, updated_at=NOW() WHERE id=$1`,
          [account.id, cop.result]
        );

        // Update user's bank verification status
        await query(
          `UPDATE users SET bank_cop_result='NO_MATCH' WHERE id=$1`,
          [t.seller_id]
        );

        return { success: false, copResult: cop.result, error: "Bank account name does not match. Payout blocked for review." };
      }

      // Mark user as bank verified on MATCH
      if (cop.result === "MATCH") {
        await query(
          `UPDATE users SET bank_verified=true, bank_cop_result='MATCH', bank_verified_at=NOW() WHERE id=$1`,
          [t.seller_id]
        );
      }
    } catch {
      copResult = "ERROR";
    }
  }

  // Send payment via Modulr (or mark as pending for manual processing)
  if (isConfigured() && account.modulr_account_id) {
    try {
      await sendPayment({
        sourceAccountId: account.modulr_account_id,
        destinationSortCode: t.bank_sort_code,
        destinationAccountNumber: t.bank_account_number,
        destinationName: t.bank_account_name || t.full_legal_name || "Seller",
        amount: payoutAmount,
        reference: payoutRef,
        externalReference: tradeId,
      });
    } catch (err) {
      console.error("[escrow] Modulr payout failed:", err);
      // Mark as pending for manual processing
      await query(
        `UPDATE escrow_accounts SET status='payout_pending', payout_amount=$2, commission_amount=$3,
         payout_sort_code=$4, payout_account_number=$5, payout_account_name=$6, payout_reference=$7,
         cop_outbound_result=$8, cop_outbound_name_match=$9, updated_at=NOW()
         WHERE id=$1`,
        [account.id, payoutAmount, commissionAmount, t.bank_sort_code,
         t.bank_account_number, t.bank_account_name, payoutRef, copResult, copMatch]
      );
      return { success: false, error: "Payout queued for manual processing" };
    }
  }

  // Update escrow account
  await query(
    `UPDATE escrow_accounts SET status='payout_sent', payout_amount=$2, commission_amount=$3,
     payout_sort_code=$4, payout_account_number=$5, payout_account_name=$6,
     payout_reference=$7, payout_sent_at=NOW(),
     cop_outbound_result=$8, cop_outbound_name_match=$9, updated_at=NOW()
     WHERE id=$1`,
    [account.id, payoutAmount, commissionAmount, t.bank_sort_code,
     t.bank_account_number, t.bank_account_name, payoutRef, copResult, copMatch]
  );

  // Update trade
  await query(
    `UPDATE market_trades SET escrow_status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [tradeId]
  );

  // Log payment event
  await query(
    `INSERT INTO payment_events (escrow_account_id, trade_id, event_type, amount, status)
     VALUES ($1, $2, 'payout_sent', $3, 'sent')`,
    [account.id, tradeId, payoutAmount]
  );

  return { success: true, amount: payoutAmount, copResult };
}

// ── Get escrow details for a trade ──

export async function getEscrowDetails(tradeId: string) {
  const result = await query(`SELECT * FROM escrow_accounts WHERE trade_id=$1`, [tradeId]);
  return result.rows[0] || null;
}

// ── Process refund ──

export async function refundBuyer(tradeId: string, reason: string): Promise<boolean> {
  const escrow = await query(`SELECT * FROM escrow_accounts WHERE trade_id=$1`, [tradeId]);
  if (escrow.rows.length === 0) return false;

  const account = escrow.rows[0];
  const refundAmount = parseFloat(account.received_amount || account.expected_amount);

  // If Modulr configured, send refund back to sender
  if (isConfigured() && account.modulr_account_id && account.sender_sort_code && account.sender_account_number) {
    try {
      await sendPayment({
        sourceAccountId: account.modulr_account_id,
        destinationSortCode: account.sender_sort_code,
        destinationAccountNumber: account.sender_account_number,
        destinationName: account.sender_name || "Buyer",
        amount: refundAmount,
        reference: `CTCG-REFUND-${account.reference}`,
        externalReference: `refund-${tradeId}`,
      });
    } catch (err) {
      console.error("[escrow] Refund failed:", err);
    }
  }

  await query(
    `UPDATE escrow_accounts SET status='refunded', refund_amount=$2, refund_sent_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [account.id, refundAmount]
  );
  await query(
    `UPDATE market_trades SET escrow_status='refunded', updated_at=NOW() WHERE id=$1`,
    [tradeId]
  );

  return true;
}

// ── Expire unpaid escrows (run periodically) ──

export async function expireUnpaidEscrows(): Promise<number> {
  const expired = await query(
    `UPDATE escrow_accounts SET status='expired', updated_at=NOW()
     WHERE status='awaiting_payment' AND expires_at < NOW()
     RETURNING trade_id`
  );

  for (const row of expired.rows) {
    await query(
      `UPDATE market_trades SET escrow_status='cancelled', updated_at=NOW() WHERE id=$1`,
      [row.trade_id]
    );
  }

  return expired.rows.length;
}
