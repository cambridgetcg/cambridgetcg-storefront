// Bounty Board transactional emails.
//
// Each function is a thin wrapper:
//   1. Look up what we need from the DB (usually the user's email).
//   2. Build a subject + layout-rendered HTML.
//   3. Send via the shared helper.
//   4. Return a SendResult — never throw. Callers in the cron path rely on
//      this so expiry itself doesn't fail on an email error.

import { query } from "@/lib/db";
import { renderLayout, escapeHtml } from "./layout";
import { sendEmail, type SendResult } from "./send";

// ── vault expired ──

export interface VaultExpiredEmailArgs {
  userId: string;
  cardName: string;
  sku: string;
  cardNumber: string | null;
  rarity: string | null;
  spotPriceGbp: number;
  soldBackCreditGbp: number;
}

export async function sendVaultExpiredEmail(args: VaultExpiredEmailArgs): Promise<SendResult> {
  const userRows = await query(
    `SELECT email, name FROM users WHERE id = $1`,
    [args.userId],
  );
  const user = userRows.rows[0];
  if (!user?.email) return { ok: false, error: "user not found or missing email" };

  const greetingName = user.name ? escapeHtml(String(user.name)) : "there";
  const cardLine =
    `${escapeHtml(args.cardName)}` +
    (args.cardNumber ? ` <span style="color:#737373;">(${escapeHtml(args.cardNumber)})</span>` : "") +
    (args.rarity ? ` <span style="color:#737373;">· ${escapeHtml(args.rarity)}</span>` : "");

  const bodyHtml = `
    <p style="margin:0 0 12px;">Hi ${greetingName},</p>
    <p style="margin:0 0 16px;">
      Your vault held on to a card for 180 days without redemption. It's now been
      auto-converted to store credit so the value doesn't sit idle.
    </p>
    <div style="background:#262626;border-radius:8px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0 0 6px;color:#fff;font-weight:600;">${cardLine}</p>
      <p style="margin:0;font-size:13px;color:#a3a3a3;">
        Spot value at acquisition: £${args.spotPriceGbp.toFixed(2)}
      </p>
      <p style="margin:4px 0 0;font-size:13px;">
        <span style="color:#34d399;font-weight:600;">+£${args.soldBackCreditGbp.toFixed(2)} store credit</span>
        <span style="color:#737373;"> (77% of spot)</span>
      </p>
    </div>
    <p style="margin:0;">
      To avoid this on future pulls, redeem or sell back before the 180-day
      window closes — you'll see a countdown on each Vault item.
    </p>
  `;

  const html = renderLayout({
    preheader: `Auto-converted to £${args.soldBackCreditGbp.toFixed(2)} store credit.`,
    heading: "A vault item expired",
    bodyHtml,
    cta: {
      label: "Open your Vault",
      url: "https://cambridgetcg.com/bounty?status=sold_back",
    },
    footer: `You're getting this email because your Bounty Board vault had an
             unredeemed item. Reply to this email if anything looks wrong.`,
  });

  return sendEmail({
    to: user.email,
    from: "bounty",
    subject: `Vault item auto-expired: £${args.soldBackCreditGbp.toFixed(2)} credit added`,
    html,
  });
}
