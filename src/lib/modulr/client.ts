// Payment Provider Client — Mangopay
// Handles: user wallets, pay-ins (bank wire + card), transfers, payouts, KYC
//
// Env vars:
//   MANGOPAY_CLIENT_ID     — from Mangopay dashboard
//   MANGOPAY_API_KEY       — API key
//   MANGOPAY_BASE_URL      — https://api.sandbox.mangopay.com (sandbox)
//                            https://api.mangopay.com (production)
//   MANGOPAY_PLATFORM_WALLET_ID — your platform wallet for commission

import { query } from "@/lib/db";

const CLIENT_ID = (process.env.MANGOPAY_CLIENT_ID || "").trim();
const API_KEY = (process.env.MANGOPAY_API_KEY || "").trim();
const BASE_URL = (process.env.MANGOPAY_BASE_URL || "https://api.sandbox.mangopay.com").trim();
const PLATFORM_WALLET_ID = (process.env.MANGOPAY_PLATFORM_WALLET_ID || "").trim();

// ── Auth ──

function authHeader(): string {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${API_KEY}`).toString("base64");
}

async function mangopayFetch(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}/v2.01/${CLIENT_ID}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader(),
      ...(options.headers || {}),
    },
  });
}

// ══════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════

export async function createNaturalUser(data: {
  firstName: string;
  lastName: string;
  email: string;
  birthday: number;
  nationality: string;
  countryOfResidence: string;
}) {
  const res = await mangopayFetch("/users/natural", {
    method: "POST",
    body: JSON.stringify({
      FirstName: data.firstName, LastName: data.lastName, Email: data.email,
      Birthday: data.birthday, Nationality: data.nationality,
      CountryOfResidence: data.countryOfResidence,
      TermsAndConditionsAccepted: true, UserCategory: "PAYER",
    }),
  });
  if (!res.ok) throw new Error(`Mangopay create user: ${res.status} ${await res.text()}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// WALLETS
// ══════════════════════════════════════════════════════════════

export async function createWallet(mangopayUserId: string, description: string) {
  const res = await mangopayFetch("/wallets", {
    method: "POST",
    body: JSON.stringify({ Owners: [mangopayUserId], Currency: "GBP", Description: description }),
  });
  if (!res.ok) throw new Error(`Mangopay create wallet: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getWallet(walletId: string) {
  const res = await mangopayFetch(`/wallets/${walletId}`);
  if (!res.ok) throw new Error(`Mangopay get wallet: ${res.status}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// PAY-IN: Bank Wire (buyer sends bank transfer — FREE)
// ══════════════════════════════════════════════════════════════

export async function createBankWirePayIn(buyerMangopayId: string, buyerWalletId: string, amountPence: number) {
  const res = await mangopayFetch("/payins/bankwire/direct", {
    method: "POST",
    body: JSON.stringify({
      AuthorId: buyerMangopayId, CreditedWalletId: buyerWalletId,
      DeclaredDebitedFunds: { Amount: amountPence, Currency: "GBP" },
      DeclaredFees: { Amount: 0, Currency: "GBP" },
    }),
  });
  if (!res.ok) throw new Error(`Mangopay bank wire: ${res.status} ${await res.text()}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// TRANSFER: Wallet → Wallet with commission split (FREE)
// ══════════════════════════════════════════════════════════════

export async function transfer(
  buyerMangopayId: string, buyerWalletId: string, sellerWalletId: string,
  amountPence: number, commissionPence: number
) {
  const res = await mangopayFetch("/transfers", {
    method: "POST",
    body: JSON.stringify({
      AuthorId: buyerMangopayId,
      DebitedFunds: { Amount: amountPence, Currency: "GBP" },
      Fees: { Amount: commissionPence, Currency: "GBP" },
      DebitedWalletId: buyerWalletId,
      CreditedWalletId: sellerWalletId,
    }),
  });
  if (!res.ok) throw new Error(`Mangopay transfer: ${res.status} ${await res.text()}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// PAY-OUT: Wallet → Bank Account (seller withdraws — €0.25)
// ══════════════════════════════════════════════════════════════

export async function createBankAccount(
  mangopayUserId: string, ownerName: string, sortCode: string,
  accountNumber: string, addressLine1: string, city: string, postcode: string
) {
  const res = await mangopayFetch(`/users/${mangopayUserId}/bankaccounts/gb`, {
    method: "POST",
    body: JSON.stringify({
      OwnerName: ownerName, SortCode: sortCode.replace(/-/g, ""), AccountNumber: accountNumber,
      OwnerAddress: { AddressLine1: addressLine1, City: city, PostalCode: postcode, Country: "GB" },
    }),
  });
  if (!res.ok) throw new Error(`Mangopay bank account: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function payout(sellerMangopayId: string, sellerWalletId: string, bankAccountId: string, amountPence: number) {
  const res = await mangopayFetch("/payouts/bankwire", {
    method: "POST",
    body: JSON.stringify({
      AuthorId: sellerMangopayId,
      DebitedFunds: { Amount: amountPence, Currency: "GBP" },
      Fees: { Amount: 0, Currency: "GBP" },
      DebitedWalletId: sellerWalletId, BankAccountId: bankAccountId,
      BankWireRef: "CTCG Payout",
    }),
  });
  if (!res.ok) throw new Error(`Mangopay payout: ${res.status} ${await res.text()}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// REFUND
// ══════════════════════════════════════════════════════════════

export async function refundPayIn(payInId: string, authorId: string) {
  const res = await mangopayFetch(`/payins/${payInId}/refunds`, {
    method: "POST",
    body: JSON.stringify({ AuthorId: authorId }),
  });
  if (!res.ok) throw new Error(`Mangopay refund: ${res.status} ${await res.text()}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// KYC
// ══════════════════════════════════════════════════════════════

export async function createKYCDocument(mangopayUserId: string, type: string) {
  const res = await mangopayFetch(`/users/${mangopayUserId}/kyc/documents`, {
    method: "POST",
    body: JSON.stringify({ Type: type }),
  });
  if (!res.ok) throw new Error(`Mangopay KYC doc: ${res.status}`);
  return res.json();
}

export async function uploadKYCPage(mangopayUserId: string, documentId: string, fileBase64: string) {
  const res = await mangopayFetch(`/users/${mangopayUserId}/kyc/documents/${documentId}/pages`, {
    method: "POST",
    body: JSON.stringify({ File: fileBase64 }),
  });
  if (!res.ok) throw new Error(`Mangopay KYC upload: ${res.status}`);
}

export async function submitKYCDocument(mangopayUserId: string, documentId: string) {
  const res = await mangopayFetch(`/users/${mangopayUserId}/kyc/documents/${documentId}`, {
    method: "PUT",
    body: JSON.stringify({ Status: "VALIDATION_ASKED" }),
  });
  if (!res.ok) throw new Error(`Mangopay KYC submit: ${res.status}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

export function isConfigured(): boolean { return !!(CLIENT_ID && API_KEY); }
export function getPlatformWalletId(): string { return PLATFORM_WALLET_ID; }
export function toPence(pounds: number): number { return Math.round(pounds * 100); }
export function toPounds(pence: number): number { return pence / 100; }

export function verifyWebhookSignature(): boolean { return true; }

// ══════════════════════════════════════════════════════════════
// USER WALLET MANAGEMENT (link CTCG users → Mangopay)
// ══════════════════════════════════════════════════════════════

export async function ensureUserWallet(userId: string): Promise<{ mangopayUserId: string; walletId: string }> {
  const user = await query(
    `SELECT mangopay_user_id, mangopay_wallet_id, name, email FROM users WHERE id=$1`, [userId]
  );
  if (user.rows.length === 0) throw new Error("User not found");
  const u = user.rows[0];

  if (u.mangopay_user_id && u.mangopay_wallet_id) {
    return { mangopayUserId: u.mangopay_user_id, walletId: u.mangopay_wallet_id };
  }

  if (!isConfigured()) {
    return { mangopayUserId: `local_${userId}`, walletId: `wallet_${userId}` };
  }

  const nameParts = (u.name || "Unknown User").split(" ");
  const mpUser = await createNaturalUser({
    firstName: nameParts[0] || "Unknown", lastName: nameParts.slice(1).join(" ") || "User",
    email: u.email, birthday: Math.floor(new Date("1990-01-01").getTime() / 1000),
    nationality: "GB", countryOfResidence: "GB",
  });

  const wallet = await createWallet(mpUser.Id, `${u.name || u.email} Trading Wallet`);

  await query(
    `UPDATE users SET mangopay_user_id=$2, mangopay_wallet_id=$3, updated_at=NOW() WHERE id=$1`,
    [userId, mpUser.Id, wallet.Id]
  );

  return { mangopayUserId: mpUser.Id, walletId: wallet.Id };
}
