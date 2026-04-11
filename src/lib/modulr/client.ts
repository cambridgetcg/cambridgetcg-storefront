// Modulr API Client
// Docs: https://www.modulrfinance.com/api-docs
//
// Environment variables:
//   MODULR_API_KEY      — API key from Modulr dashboard
//   MODULR_API_SECRET   — HMAC secret for request signing
//   MODULR_ACCOUNT_ID   — Your master account ID
//   MODULR_BASE_URL     — https://api-sandbox.modulrfinance.com (sandbox)
//                         https://api.modulrfinance.com (production)

import crypto from "crypto";

const BASE_URL = (process.env.MODULR_BASE_URL || "https://api-sandbox.modulrfinance.com").trim();
const API_KEY = (process.env.MODULR_API_KEY || "").trim();
const API_SECRET = (process.env.MODULR_API_SECRET || "").trim();
const MASTER_ACCOUNT_ID = (process.env.MODULR_ACCOUNT_ID || "").trim();

// ── Auth: HMAC signature ──

function generateAuth(): { authorization: string; date: string; nonce: string } {
  const date = new Date().toUTCString();
  const nonce = crypto.randomUUID();
  const signature = crypto
    .createHmac("sha512", API_SECRET)
    .update(`date: ${date}\nx-mod-nonce: ${nonce}`)
    .digest("base64");

  return {
    authorization: `Signature keyId="${API_KEY}",algorithm="hmac-sha512",headers="date x-mod-nonce",signature="${signature}"`,
    date,
    nonce,
  };
}

async function modulrFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const auth = generateAuth();
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": auth.authorization,
      "Date": auth.date,
      "x-mod-nonce": auth.nonce,
      ...(options.headers || {}),
    },
  });

  return res;
}

// ══════════════════════════════════════════════════════════════
// ACCOUNTS
// ══════════════════════════════════════════════════════════════

export interface ModulrAccount {
  id: string;
  name: string;
  status: string;
  balance: number;
  currency: string;
  sortCode: string;
  accountNumber: string;
  externalReference?: string;
}

export async function createVirtualAccount(name: string, externalRef: string): Promise<ModulrAccount> {
  const res = await modulrFetch("/api-sandbox/accounts", {
    method: "POST",
    body: JSON.stringify({
      customerId: MASTER_ACCOUNT_ID,
      type: "GENERAL",
      currency: "GBP",
      name,
      externalReference: externalRef,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Modulr create account failed: ${res.status} ${err}`);
  }

  return res.json();
}

export async function getAccount(accountId: string): Promise<ModulrAccount> {
  const res = await modulrFetch(`/api-sandbox/accounts/${accountId}`);
  if (!res.ok) throw new Error(`Modulr get account failed: ${res.status}`);
  return res.json();
}

export async function closeAccount(accountId: string): Promise<void> {
  await modulrFetch(`/api-sandbox/accounts/${accountId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "CLOSED" }),
  });
}

// ══════════════════════════════════════════════════════════════
// PAYMENTS (outbound — seller payouts)
// ══════════════════════════════════════════════════════════════

export interface PaymentRequest {
  sourceAccountId: string;
  destinationSortCode: string;
  destinationAccountNumber: string;
  destinationName: string;
  amount: number;
  currency?: string;
  reference: string;
  externalReference?: string;
}

export interface PaymentResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
  reference: string;
  createdDate: string;
}

export async function sendPayment(payment: PaymentRequest): Promise<PaymentResponse> {
  const res = await modulrFetch("/api-sandbox/payments", {
    method: "POST",
    body: JSON.stringify({
      sourceAccountId: payment.sourceAccountId,
      destination: {
        type: "SCAN",
        sortCode: payment.destinationSortCode,
        accountNumber: payment.destinationAccountNumber,
        name: payment.destinationName,
      },
      currency: payment.currency || "GBP",
      amount: payment.amount,
      reference: payment.reference,
      externalReference: payment.externalReference,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Modulr send payment failed: ${res.status} ${err}`);
  }

  return res.json();
}

// ══════════════════════════════════════════════════════════════
// CONFIRMATION OF PAYEE (CoP)
// ══════════════════════════════════════════════════════════════

export interface CoPResult {
  result: "MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "NOT_AVAILABLE" | "ERROR";
  matchedName?: string;
  reasonCode?: string;
}

export async function checkCoP(sortCode: string, accountNumber: string, name: string): Promise<CoPResult> {
  const res = await modulrFetch("/api-sandbox/cop/verify", {
    method: "POST",
    body: JSON.stringify({
      sortCode,
      accountNumber,
      name,
      accountType: "PERSONAL",
    }),
  });

  if (!res.ok) {
    console.error("[modulr] CoP check failed:", res.status);
    return { result: "ERROR" };
  }

  return res.json();
}

// ══════════════════════════════════════════════════════════════
// WEBHOOK VERIFICATION
// ══════════════════════════════════════════════════════════════

export function verifyWebhookSignature(body: string, signature: string, secret?: string): boolean {
  const webhookSecret = secret || API_SECRET;
  const computed = crypto
    .createHmac("sha512", webhookSecret)
    .update(body)
    .digest("base64");
  return computed === signature;
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

export function isConfigured(): boolean {
  return !!(API_KEY && API_SECRET && MASTER_ACCOUNT_ID);
}

export function getMasterAccountId(): string {
  return MASTER_ACCOUNT_ID;
}
