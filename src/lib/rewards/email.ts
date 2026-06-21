// Reward emails — raffle winner notification + future per-feature
// notifications go here. Direct SES path (not the queue) since wins are
// rare and the cron tolerates SES retry latency.

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

function tpl(title: string, body: string, ctaText: string, ctaUrl: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background:#171717;border-radius:16px;">
    <h1 style="color:#fff;font-size:20px;margin:0 0 8px;">Cambridge <span style="color:#34d399;">TCG</span></h1>
    <h2 style="color:#fff;font-size:16px;margin:0 0 16px;">${title}</h2>
    <div style="color:#a3a3a3;font-size:14px;line-height:1.6;">${body}</div>
    <a href="${ctaUrl}" style="display:inline-block;padding:12px 32px;background:#f59e0b;color:#000;font-weight:700;text-decoration:none;border-radius:8px;font-size:14px;margin-top:16px;">${ctaText}</a>
    <p style="color:#525252;font-size:12px;margin:24px 0 0;">Cambridge TCG &mdash; Rewards</p>
  </div>
</body></html>`;
}

export async function sendPrizeShippedEmail(d: {
  email: string;
  name: string | null;
  prizeLabel: string;
  trackingNumber: string | null;
}): Promise<void> {
  const url = `${SITE}/account/rewards`;
  const tracking = d.trackingNumber
    ? `Tracking: <strong style="font-family:monospace;">${d.trackingNumber}</strong>`
    : "It's on its way without a tracking number — keep an eye on your post.";
  const subject = `Shipped: ${d.prizeLabel}`;
  const text = `Your prize "${d.prizeLabel}" has shipped.${d.trackingNumber ? ` Tracking: ${d.trackingNumber}` : ""}. ${url}`;
  const html = tpl(
    "Your prize is on the way",
    `<p>${d.name ? `Hi ${d.name}, ` : ""}we just shipped <strong>${d.prizeLabel}</strong>.</p>
     <p>${tracking}</p>`,
    "View prize",
    url,
  );
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [d.email] },
    Message: { Subject: { Data: subject }, Body: { Text: { Data: text }, Html: { Data: html } } },
  }));
}

export async function sendRaffleWinnerEmail(d: {
  email: string;
  name: string | null;
  raffleTitle: string;
  prizeDescription: string;
}): Promise<void> {
  const url = `${SITE}/account/rewards`;
  const subject = `🎉 You won the ${d.raffleTitle} raffle!`;
  const text = `Congratulations${d.name ? `, ${d.name}` : ""}! You won "${d.raffleTitle}" — prize: ${d.prizeDescription}. Confirm your shipping at ${url}`;
  const html = tpl(
    "You won the raffle!",
    `<p>${d.name ? `Hi ${d.name}, ` : ""}your name was drawn for the <strong>${d.raffleTitle}</strong> raffle.</p>
     <p style="color:#fff;font-size:16px;"><strong>Prize:</strong> ${d.prizeDescription}</p>
     <p>Visit your rewards page to confirm your shipping address. Physical prizes ship within a few business days.</p>`,
    "Claim your prize",
    url,
  );
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [d.email] },
    Message: { Subject: { Data: subject }, Body: { Text: { Data: text }, Html: { Data: html } } },
  }));
}
