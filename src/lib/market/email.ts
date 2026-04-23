import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: (process.env.AWS_REGION || "us-east-1").trim(),
  credentials: {
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || "").trim(),
  },
});

const FROM = (process.env.AUTH_FROM_EMAIL || "noreply@cambridgetcg.com").trim();
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://cambridgetcg.com").trim().replace(/\/+$/, "");

function tpl(title: string, body: string, ctaText?: string, ctaUrl?: string): string {
  const cta = ctaText && ctaUrl
    ? `<a href="${ctaUrl}" style="display:inline-block;padding:12px 32px;background:#f59e0b;color:#000;font-weight:700;text-decoration:none;border-radius:8px;font-size:14px;margin-top:16px;">${ctaText}</a>`
    : "";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background:#171717;border-radius:16px;">
    <h1 style="color:#fff;font-size:20px;margin:0 0 8px;">Cambridge <span style="color:#34d399;">TCG</span></h1>
    <h2 style="color:#fff;font-size:16px;margin:0 0 16px;">${title}</h2>
    <div style="color:#a3a3a3;font-size:14px;line-height:1.6;">${body}</div>
    ${cta}
    <p style="color:#525252;font-size:12px;margin:24px 0 0;">Cambridge TCG &mdash; Japanese Trading Cards</p>
  </div>
</body></html>`;
}

async function send(to: string, subject: string, html: string, text: string) {
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [to] },
    Message: { Subject: { Data: subject }, Body: { Text: { Data: text }, Html: { Data: html } } },
  }));
}

const tradesUrl = `${SITE}/account/trades`;

// ── Match notifications ──

export async function sendBuyerMatchEmail(d: {
  email: string; cardName: string; price: string; expiresAt: string;
}) {
  const subject = `Action required: pay for ${d.cardName}`;
  const text = `Your bid matched on "${d.cardName}" at ${d.price}. Pay within 24 hours or the trade will be cancelled. ${tradesUrl}`;
  const html = tpl(
    "Your bid matched &mdash; please pay",
    `<p>Your bid for <strong>${d.cardName}</strong> matched a seller at <strong style="color:#f59e0b;">${d.price}</strong>.</p>
     <p>Please complete payment within <strong>24 hours</strong> (by ${new Date(d.expiresAt).toUTCString()}). If you do not pay, the trade will be cancelled and the seller's listing returned to the market.</p>`,
    "Pay Now", tradesUrl
  );
  await send(d.email, subject, html, text);
}

export async function sendSellerMatchEmail(d: {
  email: string; cardName: string; price: string;
}) {
  const subject = `You sold ${d.cardName} &mdash; awaiting buyer payment`;
  const text = `Your ask for "${d.cardName}" filled at ${d.price}. We're waiting for the buyer to pay; we'll email shipping instructions next. ${tradesUrl}`;
  const html = tpl(
    "Your listing filled",
    `<p>Your ask for <strong>${d.cardName}</strong> matched at <strong style="color:#f59e0b;">${d.price}</strong>.</p>
     <p>The buyer has 24 hours to pay. As soon as we receive payment we'll send you shipping instructions, including which address to ship to and what packaging is required for this trade's escrow tier.</p>`,
    "View Trade", tradesUrl
  );
  await send(d.email, subject, html, text);
}

// ── Payment received ──

export async function sendBuyerPaidEmail(d: {
  email: string; cardName: string; price: string; tier: string;
}) {
  const subject = `Payment received: ${d.cardName}`;
  const text = `We received your payment of ${d.price} for "${d.cardName}". Tier: ${d.tier}. Track progress at ${tradesUrl}`;
  const html = tpl(
    "Payment received",
    `<p>We've received your payment for <strong>${d.cardName}</strong>.</p>
     <p>Amount: <strong>${d.price}</strong><br/>Escrow tier: <strong>${d.tier}</strong></p>
     <p>The seller will ship next. You'll get a tracking email when the card is on its way to you.</p>`,
    "View Trade", tradesUrl
  );
  await send(d.email, subject, html, text);
}

export async function sendSellerPaidEmail(d: {
  email: string; cardName: string; price: string; tier: string; shipsTo: "buyer" | "ctcg"; payout: string;
}) {
  const dest = d.shipsTo === "ctcg" ? "Cambridge TCG (we'll forward to the buyer)" : "the buyer directly";
  const subject = `Payment confirmed &mdash; please ship ${d.cardName}`;
  const text = `Buyer paid ${d.price} for "${d.cardName}". Ship to ${dest}. Your payout will be ${d.payout}. Details: ${tradesUrl}`;
  const html = tpl(
    "Buyer has paid &mdash; ship now",
    `<p>The buyer has paid <strong>${d.price}</strong> for <strong>${d.cardName}</strong>.</p>
     <p>Escrow tier: <strong>${d.tier}</strong>. Ship to: <strong>${dest}</strong>.</p>
     <p>Your payout after commission: <strong style="color:#34d399;">${d.payout}</strong>, released after delivery and any tier-specific verification.</p>`,
    "Get Shipping Details", tradesUrl
  );
  await send(d.email, subject, html, text);
}

// ── Status transitions (admin-driven) ──

export async function sendStatusEmail(d: {
  email: string; cardName: string; subject: string; heading: string; body: string;
}) {
  const text = `${d.heading} &mdash; ${d.cardName}. ${tradesUrl}`;
  const html = tpl(d.heading, `<p>${d.body}</p>`, "View Trade", tradesUrl);
  await send(d.email, d.subject, html, text);
}

// ── Payout sent ──

export async function sendPayoutEmail(d: {
  email: string; cardName: string; amount: string; method: string; reference?: string | null;
}) {
  const subject = `Payout sent: ${d.cardName} (${d.amount})`;
  const refLine = d.reference ? `Reference: ${d.reference}\n` : "";
  const text = `Your payout of ${d.amount} for "${d.cardName}" has been sent via ${d.method}.\n${refLine}${tradesUrl}`;
  const html = tpl(
    "Payout sent",
    `<p>Your payout for <strong>${d.cardName}</strong> has been sent.</p>
     <p>Amount: <strong style="color:#34d399;">${d.amount}</strong><br/>
        Method: ${d.method}${d.reference ? `<br/>Reference: <code>${d.reference}</code>` : ""}</p>
     <p>Allow a few business days for the payment to land in your account.</p>`,
    "View Trade", tradesUrl
  );
  await send(d.email, subject, html, text);
}

// ── Cancel (timeout) ──

export async function sendCancelEmail(d: {
  email: string; cardName: string; reason: string;
}) {
  const subject = `Trade cancelled: ${d.cardName}`;
  const text = `Trade for "${d.cardName}" was cancelled. Reason: ${d.reason}. ${tradesUrl}`;
  const html = tpl(
    "Trade cancelled",
    `<p>The trade for <strong>${d.cardName}</strong> was cancelled.</p>
     <p>Reason: ${d.reason}</p>`,
    "View Trades", tradesUrl
  );
  await send(d.email, subject, html, text);
}
