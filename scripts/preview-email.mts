// Renders email templates to /tmp/*.html for eyeballing in a browser.
// Usage: npx tsx scripts/preview-email.mts
//        open /tmp/vault-expired.html

import { writeFileSync } from "node:fs";
const { renderLayout } = await import("../src/lib/email/layout.ts");

// vault_expired preview (mirrors the real template in src/lib/email/bounty.ts
// but with hardcoded sample data — no DB lookup).
const vaultExpiredHtml = renderLayout({
  preheader: `Auto-converted to £7.70 store credit.`,
  heading: "A vault item expired",
  bodyHtml: `
    <p style="margin:0 0 12px;">Hi Asha,</p>
    <p style="margin:0 0 16px;">
      Your vault held on to a card for 180 days without redemption. It's now been
      auto-converted to store credit so the value doesn't sit idle.
    </p>
    <div style="background:#262626;border-radius:8px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0 0 6px;color:#fff;font-weight:600;">
        Portgas D. Ace <span style="color:#737373;">(OP01-013)</span> <span style="color:#737373;">· SR</span>
      </p>
      <p style="margin:0;font-size:13px;color:#a3a3a3;">Spot value at acquisition: £10.00</p>
      <p style="margin:4px 0 0;font-size:13px;">
        <span style="color:#34d399;font-weight:600;">+£7.70 store credit</span>
        <span style="color:#737373;"> (77% of spot)</span>
      </p>
    </div>
    <p style="margin:0;">
      To avoid this on future pulls, redeem or sell back before the 180-day
      window closes — you'll see a countdown on each Vault item.
    </p>
  `,
  cta: { label: "Open your Vault", url: "https://cambridgetcg.com/bounty?status=sold_back" },
  footer: `You're getting this email because your Bounty Board vault had an
           unredeemed item. Reply to this email if anything looks wrong.`,
});

writeFileSync("/tmp/vault-expired.html", vaultExpiredHtml);
console.log("wrote /tmp/vault-expired.html — open it to preview");
console.log(`bytes: ${vaultExpiredHtml.length}`);
