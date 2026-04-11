// Escrow Manager — Mangopay wallet-based P2P payment flow
//
// 1. Trade matched → ensure both users have wallets → create bank wire pay-in
// 2. Buyer sends bank transfer → Mangopay webhook confirms → funds in buyer wallet
// 3. Trade completes → transfer buyer→seller wallet (commission deducted to platform)
// 4. Seller requests payout → funds to their bank account

import { query } from "@/lib/db";
import {
  ensureUserWallet, createBankWirePayIn, transfer, payout,
  createBankAccount, refundPayIn, isConfigured, toPence, toPounds,
} from "./client";
import crypto from "crypto";

function generateReference(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "CTCG-";
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

// ── Create escrow for a matched trade ──

export async function createEscrowForTrade(tradeId: string) {
  const tradeResult = await query(
    `SELECT t.*, bu.name as buyer_name FROM market_trades t JOIN users bu ON t.buyer_id=bu.id WHERE t.id=$1`,
    [tradeId]
  );
  if (tradeResult.rows.length === 0) return null;

  const trade = tradeResult.rows[0];
  const amount = parseFloat(trade.price) * trade.quantity;
  const reference = generateReference();
  const accountName = `CTCG Escrow ${reference}`;
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  let sortCode = process.env.ESCROW_SORT_CODE || "00-00-00";
  let accountNumber = process.env.ESCROW_ACCOUNT_NUMBER || crypto.randomBytes(4).toString("hex").substring(0, 8);
  let mangopayPayInId = null;

  if (isConfigured()) {
    try {
      const buyerWallet = await ensureUserWallet(trade.buyer_id);
      const payIn = await createBankWirePayIn(buyerWallet.mangopayUserId, buyerWallet.walletId, toPence(amount));
      mangopayPayInId = payIn.Id;
      if (payIn.BankAccount?.SortCode) sortCode = payIn.BankAccount.SortCode;
      if (payIn.BankAccount?.AccountNumber) accountNumber = payIn.BankAccount.AccountNumber;
    } catch (err) {
      console.error("[escrow] Mangopay pay-in failed:", err);
    }
  }

  await query(
    `INSERT INTO escrow_accounts (trade_id, modulr_account_id, sort_code, account_number, account_name, reference, expected_amount, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (trade_id) DO UPDATE SET modulr_account_id=$2, sort_code=$3, account_number=$4, reference=$6, expected_amount=$7, expires_at=$8, updated_at=NOW()`,
    [tradeId, mangopayPayInId, sortCode, accountNumber, accountName, reference, amount.toFixed(2), expiresAt.toISOString()]
  );

  await query(`UPDATE market_trades SET escrow_status='awaiting_payment', updated_at=NOW() WHERE id=$1`, [tradeId]);

  return { sortCode, accountNumber, accountName, reference, amount, expiresAt: expiresAt.toISOString() };
}

// ── Process incoming payment (webhook) ──

export async function processIncomingPayment(data: {
  accountNumber?: string;
  amount: number;
  senderName: string;
  senderSortCode?: string;
  senderAccountNumber?: string;
  modulrPaymentId?: string;
  rawPayload?: object;
}) {
  const params: unknown[] = [];
  let where = "status='awaiting_payment'";
  if (data.modulrPaymentId) { params.push(data.modulrPaymentId); where += ` AND modulr_account_id=$1`; }
  else if (data.accountNumber) { params.push(data.accountNumber); where += ` AND account_number=$1`; }
  else return { tradeId: null, success: false, error: "No identifier" };

  const escrow = await query(`SELECT * FROM escrow_accounts WHERE ${where}`, params);
  if (escrow.rows.length === 0) return { tradeId: null, success: false, error: "No match" };

  const account = escrow.rows[0];

  await query(
    `INSERT INTO payment_events (escrow_account_id, trade_id, event_type, modulr_payment_id, amount, sender_name, status, raw_payload)
     VALUES ($1,$2,'payment_received',$3,$4,$5,'received',$6)`,
    [account.id, account.trade_id, data.modulrPaymentId, data.amount, data.senderName, JSON.stringify(data.rawPayload || {})]
  );

  await query(
    `UPDATE escrow_accounts SET status='payment_received', received_amount=$2, received_at=NOW(), sender_name=$3, updated_at=NOW() WHERE id=$1`,
    [account.id, data.amount, data.senderName]
  );
  await query(`UPDATE market_trades SET escrow_status='paid', buyer_paid_at=NOW(), updated_at=NOW() WHERE id=$1`, [account.trade_id]);

  return { tradeId: account.trade_id, success: true };
}

// ── Complete trade: transfer with commission split ──

export async function completeTrade(tradeId: string) {
  const trade = await query(`SELECT * FROM market_trades WHERE id=$1`, [tradeId]);
  if (trade.rows.length === 0) return { success: false, error: "Not found" };

  const t = trade.rows[0];
  const totalPence = toPence(parseFloat(t.price) * t.quantity);
  const commissionPence = toPence(parseFloat(t.commission_amount));

  if (isConfigured()) {
    try {
      const buyerWallet = await ensureUserWallet(t.buyer_id);
      const sellerWallet = await ensureUserWallet(t.seller_id);
      await transfer(buyerWallet.mangopayUserId, buyerWallet.walletId, sellerWallet.walletId, totalPence, commissionPence);
    } catch (err) {
      console.error("[escrow] Transfer failed:", err);
      return { success: false, error: "Transfer failed" };
    }
  }

  const sellerAmount = toPounds(totalPence - commissionPence);
  await query(
    `UPDATE escrow_accounts SET status='payout_pending', payout_amount=$2, commission_amount=$3, updated_at=NOW() WHERE trade_id=$1`,
    [tradeId, sellerAmount.toFixed(2), toPounds(commissionPence).toFixed(2)]
  );

  return { success: true, sellerAmount, commission: toPounds(commissionPence) };
}

// ── Seller payout: wallet → bank ──

export async function payoutSeller(tradeId: string) {
  const trade = await query(
    `SELECT t.*, v.bank_sort_code, v.bank_account_number, v.bank_account_name, v.full_legal_name, v.address_line1, v.city, v.postcode
     FROM market_trades t LEFT JOIN user_verifications v ON t.seller_id=v.user_id WHERE t.id=$1`,
    [tradeId]
  );
  if (trade.rows.length === 0) return { success: false, error: "Not found" };
  const t = trade.rows[0];
  if (!t.bank_sort_code) return { success: false, error: "No bank details" };

  const escrow = await query(`SELECT * FROM escrow_accounts WHERE trade_id=$1`, [tradeId]);
  const payoutAmount = parseFloat(escrow.rows[0]?.payout_amount || t.seller_payout);

  if (isConfigured()) {
    try {
      const sellerWallet = await ensureUserWallet(t.seller_id);
      const bankAccount = await createBankAccount(
        sellerWallet.mangopayUserId, t.bank_account_name || t.full_legal_name || "Seller",
        t.bank_sort_code, t.bank_account_number, t.address_line1 || "UK", t.city || "UK", t.postcode || "UK"
      );
      await payout(sellerWallet.mangopayUserId, sellerWallet.walletId, bankAccount.Id, toPence(payoutAmount));
    } catch (err) {
      console.error("[escrow] Payout failed:", err);
      await query(`UPDATE escrow_accounts SET status='payout_pending', updated_at=NOW() WHERE trade_id=$1`, [tradeId]);
      return { success: false, error: "Queued for manual processing" };
    }
  }

  await query(`UPDATE escrow_accounts SET status='completed', payout_sent_at=NOW(), updated_at=NOW() WHERE trade_id=$1`, [tradeId]);
  await query(`UPDATE market_trades SET escrow_status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1`, [tradeId]);
  return { success: true, amount: payoutAmount };
}

// ── Refund ──

export async function refundBuyer(tradeId: string, reason: string) {
  const escrow = await query(`SELECT * FROM escrow_accounts WHERE trade_id=$1`, [tradeId]);
  if (escrow.rows.length === 0) return false;
  const account = escrow.rows[0];

  if (isConfigured() && account.modulr_account_id) {
    try {
      const trade = await query(`SELECT buyer_id FROM market_trades WHERE id=$1`, [tradeId]);
      const buyerWallet = await ensureUserWallet(trade.rows[0].buyer_id);
      await refundPayIn(account.modulr_account_id, buyerWallet.mangopayUserId);
    } catch (err) { console.error("[escrow] Refund failed:", err); }
  }

  await query(`UPDATE escrow_accounts SET status='refunded', refund_amount=$2, refund_sent_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [account.id, account.received_amount || account.expected_amount]);
  await query(`UPDATE market_trades SET escrow_status='refunded', updated_at=NOW() WHERE id=$1`, [tradeId]);
  return true;
}

export async function getEscrowDetails(tradeId: string) {
  const result = await query(`SELECT * FROM escrow_accounts WHERE trade_id=$1`, [tradeId]);
  return result.rows[0] || null;
}

export async function expireUnpaidEscrows() {
  const expired = await query(
    `UPDATE escrow_accounts SET status='expired', updated_at=NOW() WHERE status='awaiting_payment' AND expires_at < NOW() RETURNING trade_id`
  );
  for (const row of expired.rows) {
    await query(`UPDATE market_trades SET escrow_status='cancelled', updated_at=NOW() WHERE id=$1`, [row.trade_id]);
  }
  return expired.rows.length;
}
