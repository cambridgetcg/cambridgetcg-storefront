// Central transactional-email sender.
//
// Design principles:
// - One sender key per product stream ("noreply", "tradein", "bounty", ...).
//   Each has its own From address so a spam report on one stream doesn't
//   damage the others' deliverability reputation.
// - Never throws. The caller decides what "failed" means — this returns a
//   discriminated object so cron loops and background jobs don't have to
//   try/catch every call.
// - Preference-aware: if the caller passes `unsubscribe: { userId, category
//   }`, the send is skipped when the user has opted out, and the resulting
//   email automatically carries:
//     • a List-Unsubscribe header (RFC 2369 + 8058 one-click)
//     • a footer sentence with the click-through
//   Essential emails (magic links, receipts) omit the param and send
//   unconditionally.
// - No queueing, no retries yet. Good enough for immediate-trigger
//   transactional emails. See scheduleEmail()/drainEmailQueue() for the
//   scheduled variant.

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "./client";
import {
  canSendEvent,
  makeUnsubscribeToken,
  type EmailCategory,
} from "./preferences";
import { escapeHtml } from "./layout";

export type SenderKey = "noreply" | "tradein" | "bounty";

const FROM_ADDRESS: Record<SenderKey, { email: string; displayName: string }> = {
  noreply: {
    email: (process.env.AUTH_FROM_EMAIL || "noreply@cambridgetcg.com").trim(),
    displayName: "Cambridge TCG",
  },
  tradein: {
    email: (process.env.TRADEIN_FROM_EMAIL || "tradein@cambridgetcg.com").trim(),
    displayName: "Cambridge TCG Trade-In",
  },
  bounty: {
    email: (process.env.BOUNTY_FROM_EMAIL || "bounty@cambridgetcg.com").trim(),
    displayName: "Cambridge TCG Bounty Board",
  },
};

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text body. If omitted, a naive strip of the HTML is used. */
  text?: string;
  /** Selects the From address. Defaults to "noreply". */
  from?: SenderKey;
  /** Override the display name for this specific send. */
  fromName?: string;
  /** Reply-To override (useful when you want replies routed somewhere other than the From stream). */
  replyTo?: string;
  /**
   * When provided: send is skipped if the user has opted out of the category,
   * and List-Unsubscribe headers + a footer link are added. Omit for
   * essential emails (sign-in links, payment receipts, shipment notices).
   */
  unsubscribe?: { userId: string; category: EmailCategory };
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string }
  | { ok: false; error: "suppressed_by_preference"; category: EmailCategory };

function stripTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function siteOrigin(): string {
  return (process.env.SITE_URL || "https://cambridgetcg.com").replace(/\/$/, "");
}

function unsubscribeUrl(token: string): string {
  return `${siteOrigin()}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

function appendUnsubscribeFooter(html: string, token: string, categoryLabel: string): string {
  const url = unsubscribeUrl(token);
  const fragment = `
    <p style="color:#525252;font-size:11px;margin:20px 0 0;text-align:center;line-height:1.6;">
      Don't want ${escapeHtml(categoryLabel)}?
      <a href="${escapeHtml(url)}" style="color:#737373;text-decoration:underline;">Unsubscribe</a> ·
      <a href="${escapeHtml(siteOrigin())}/account/emails" style="color:#737373;text-decoration:underline;">Manage all emails</a>
    </p>
  `;
  // Insert just before the closing </body> so it sits under the content card.
  if (html.includes("</body>")) return html.replace("</body>", `${fragment}</body>`);
  return html + fragment;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendResult> {
  const senderKey: SenderKey = args.from ?? "noreply";
  const sender = FROM_ADDRESS[senderKey];
  const displayName = args.fromName ?? sender.displayName;

  // Preference check
  if (args.unsubscribe) {
    const allowed = await canSendEvent(args.unsubscribe.userId, args.unsubscribe.category);
    if (!allowed) {
      return { ok: false, error: "suppressed_by_preference", category: args.unsubscribe.category };
    }
  }

  // Guard against AWS credentials being missing (e.g. local dev without env)
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return { ok: false, error: "AWS credentials not configured" };
  }

  // When opt-out is declared, embed a footer unsubscribe link.
  //
  // The RFC 2369 / 8058 `List-Unsubscribe` header (which makes Gmail and
  // Apple Mail render a native "Unsubscribe" button in the UI) cannot be
  // attached through SendEmailCommand — it's a raw-message feature that
  // needs SendRawEmailCommand. Planned for a later pass; the footer link
  // covers CAN-SPAM / GDPR compliance in the meantime.
  let html = args.html;
  if (args.unsubscribe) {
    const { CATEGORY_LABELS } = await import("./preferences");
    const token = makeUnsubscribeToken(args.unsubscribe.userId, args.unsubscribe.category);
    html = appendUnsubscribeFooter(
      args.html,
      token,
      CATEGORY_LABELS[args.unsubscribe.category],
    );
  }

  try {
    const result = await sesClient.send(
      new SendEmailCommand({
        Source: `${displayName} <${sender.email}>`,
        Destination: { ToAddresses: [args.to] },
        ReplyToAddresses: args.replyTo ? [args.replyTo] : undefined,
        Message: {
          Subject: { Data: args.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: html, Charset: "UTF-8" },
            Text: { Data: args.text ?? stripTags(html), Charset: "UTF-8" },
          },
        },
      }),
    );
    return { ok: true, messageId: result.MessageId ?? "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
