import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: (process.env.AWS_REGION || "us-east-1").trim(),
  credentials: {
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || "").trim(),
  },
});

const FROM_EMAIL = process.env.TRADEIN_FROM_EMAIL || "tradein@cambridgetcg.com";
const STORE_NOTIFICATION_EMAIL = process.env.STORE_NOTIFICATION_EMAIL || "contact@cambridgetcg.com";

interface EmailItem {
  name: string;
  card_number: string;
  quantity: number;
  cash_price: number;
  credit_price: number;
}

export async function sendConfirmationEmail(data: {
  reference: string;
  customerName: string;
  customerEmail: string;
  paymentMethod: string;
  deliveryMethod: string;
  items: EmailItem[];
  cashTotal: number;
  creditTotal: number;
  expiresAt: Date;
}) {
  const total = data.paymentMethod === "cash" ? data.cashTotal : data.creditTotal;
  const totalLabel = data.paymentMethod === "cash" ? "Cash" : "Store Credit";
  const expiryDate = data.expiresAt.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const shippingNote =
    total >= 100
      ? "\nShipping Contribution: We will contribute £2.70 towards your shipping costs.\n"
      : "";

  const itemsList = data.items
    .map(
      (i) =>
        `  ${i.quantity}x ${i.name} (${i.card_number}) — £${(data.paymentMethod === "cash" ? i.cash_price : i.credit_price).toFixed(2)} each`
    )
    .join("\n");

  const mailInInstructions =
    data.deliveryMethod === "mail"
      ? `\nShipping Instructions:
Please send your cards to:
  Cambridge TCG
  PO Box 1637
  CAMBRIDGE
  CB1 0PD

Include your reference number (${data.reference}) on the package.
${shippingNote}`
      : `\nIn-Store Drop-Off:
Bring your cards to our shop and quote your reference: ${data.reference}
`;

  const textBody = `Hi ${data.customerName},

Thank you for your trade-in request with Cambridge TCG!

Reference: ${data.reference}
Payment Method: ${totalLabel}
Total Payout: £${total.toFixed(2)}
Quote Valid Until: ${expiryDate}

Items:
${itemsList}
${mailInInstructions}
What happens next:
1. Send us your cards (or drop them off in-store)
2. We'll grade and verify your cards
3. Payment will be processed (${data.paymentMethod === "cash" ? "2 business days" : "1 business day"} after grading)

If you have any questions, reply to this email or contact us at contact@cambridgetcg.com.

Best regards,
Cambridge TCG Team
`;

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #ededed; padding: 20px;">
<div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; padding: 32px;">
  <h1 style="color: #f59e0b; margin-top: 0;">Trade-In Request Received</h1>
  <p>Hi ${escapeHtml(data.customerName)},</p>
  <p>Thank you for your trade-in request!</p>

  <div style="background: #262626; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 4px 0;"><strong>Reference:</strong> <span style="color: #f59e0b; font-size: 18px;">${data.reference}</span></p>
    <p style="margin: 4px 0;"><strong>Payment:</strong> ${totalLabel}</p>
    <p style="margin: 4px 0;"><strong>Total:</strong> <span style="color: #f59e0b; font-weight: bold;">£${total.toFixed(2)}</span></p>
    <p style="margin: 4px 0;"><strong>Valid Until:</strong> ${expiryDate}</p>
  </div>

  <h3>Items</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <thead>
      <tr style="border-bottom: 1px solid #404040;">
        <th style="text-align: left; padding: 8px 4px; color: #a3a3a3;">Card</th>
        <th style="text-align: center; padding: 8px 4px; color: #a3a3a3;">Qty</th>
        <th style="text-align: right; padding: 8px 4px; color: #a3a3a3;">Price</th>
      </tr>
    </thead>
    <tbody>
      ${data.items
        .map(
          (i) => `<tr style="border-bottom: 1px solid #333;">
        <td style="padding: 8px 4px;">${escapeHtml(i.name)} <span style="color: #737373;">(${escapeHtml(i.card_number)})</span></td>
        <td style="text-align: center; padding: 8px 4px;">${i.quantity}</td>
        <td style="text-align: right; padding: 8px 4px; color: #f59e0b;">£${(data.paymentMethod === "cash" ? i.cash_price : i.credit_price).toFixed(2)}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>

  ${
    total >= 100
      ? '<p style="color: #34d399; margin-top: 12px;">We will contribute £2.70 towards your shipping costs.</p>'
      : ""
  }

  ${
    data.deliveryMethod === "mail"
      ? `<div style="background: #262626; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <h3 style="margin-top: 0;">Shipping Instructions</h3>
    <p>Please send your cards to:</p>
    <p style="margin-left: 16px;">
      Cambridge TCG<br>
      PO Box 1637<br>
      CAMBRIDGE<br>
      CB1 0PD
    </p>
    <p>Include your reference number <strong>${data.reference}</strong> on the package.</p>
  </div>`
      : `<div style="background: #262626; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <h3 style="margin-top: 0;">In-Store Drop-Off</h3>
    <p>Bring your cards to our shop and quote your reference: <strong>${data.reference}</strong></p>
  </div>`
  }

  <p style="color: #a3a3a3; font-size: 14px; margin-top: 24px;">
    If you have any questions, reply to this email or contact us at contact@cambridgetcg.com.
  </p>
</div>
</body>
</html>`;

  const subject = `Trade-In Request ${data.reference} — Cambridge TCG`;

  try {
    await ses.send(
      new SendEmailCommand({
        Source: `Cambridge TCG Trade-In <${FROM_EMAIL}>`,
        Destination: { ToAddresses: [data.customerEmail] },
        Message: {
          Subject: { Data: subject },
          Body: {
            Text: { Data: textBody },
            Html: { Data: htmlBody },
          },
        },
      })
    );

    // Also notify the store
    try {
      await ses.send(
        new SendEmailCommand({
          Source: `Cambridge TCG Trade-In <${FROM_EMAIL}>`,
          Destination: { ToAddresses: [STORE_NOTIFICATION_EMAIL] },
          Message: {
            Subject: { Data: `New Trade-In: ${data.reference} — £${total.toFixed(2)} ${totalLabel}` },
            Body: {
              Text: {
                Data: `New trade-in submission:\n\nRef: ${data.reference}\nCustomer: ${data.customerName} (${data.customerEmail})\nPayment: ${totalLabel}\nTotal: £${total.toFixed(2)}\nDelivery: ${data.deliveryMethod}\nItems: ${data.items.length}\n\nView in admin panel to process.`,
              },
            },
          },
        })
      );
    } catch (storeErr) {
      console.error("[tradein] Failed to send store notification:", storeErr);
    }
  } catch (err) {
    console.error("[tradein] Failed to send confirmation email:", err);
    // Don't throw — submission still succeeds even if email fails
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
