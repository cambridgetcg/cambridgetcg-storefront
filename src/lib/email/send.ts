// Central transactional-email sender.
//
// Design principles:
// - One sender key per product stream ("noreply", "tradein", "bounty", ...).
//   Each has its own From address so a spam report on one stream doesn't
//   damage the others' deliverability reputation.
// - Never throws. The caller decides what "failed" means — this returns a
//   discriminated object so cron loops and background jobs don't have to
//   try/catch every call.
// - No queueing, no retries yet. Good enough for immediate-trigger
//   transactional emails. A later pass can add email_queue if we need
//   scheduled/delayed delivery.

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "./client";

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
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

function stripTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sendEmail(args: SendEmailArgs): Promise<SendResult> {
  const senderKey: SenderKey = args.from ?? "noreply";
  const sender = FROM_ADDRESS[senderKey];
  const displayName = args.fromName ?? sender.displayName;

  // Guard against AWS credentials being missing (e.g. local dev without env)
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return { ok: false, error: "AWS credentials not configured" };
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
            Html: { Data: args.html, Charset: "UTF-8" },
            Text: { Data: args.text ?? stripTags(args.html), Charset: "UTF-8" },
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
