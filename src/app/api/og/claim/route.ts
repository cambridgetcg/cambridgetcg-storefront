import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { query } from "@/lib/db";

// POST — submit OG claim (public) or approve/reject (admin)
export async function POST(request: Request) {
  const body = await request.json();

  // Admin actions
  if (body.action === "approve" || body.action === "reject") {
    if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { claimId, adminNotes } = body;
    if (!claimId) return NextResponse.json({ error: "Claim ID required." }, { status: 400 });

    if (body.action === "approve") {
      // Get claim
      const claim = await query(`SELECT * FROM og_claims WHERE id=$1`, [claimId]);
      if (claim.rows.length === 0) return NextResponse.json({ error: "Claim not found." }, { status: 404 });

      // Assign OG tier
      const tierResult = await query(`SELECT id FROM tiers WHERE name='OG'`);
      if (tierResult.rows.length === 0) return NextResponse.json({ error: "OG tier not found." }, { status: 500 });
      const tierId = tierResult.rows[0].id;

      // Find or create user
      let userResult = await query(`SELECT id FROM users WHERE email=LOWER($1)`, [claim.rows[0].email]);
      if (userResult.rows.length === 0) {
        userResult = await query(`INSERT INTO users (email) VALUES (LOWER($1)) RETURNING id`, [claim.rows[0].email]);
      }

      // Assign OG tier (manual — won't be overridden)
      await query(
        `UPDATE users SET tier_id=$2, tier_source='manual', tier_calculated_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [userResult.rows[0].id, tierId]
      );

      // Update claim
      await query(
        `UPDATE og_claims SET status='approved', admin_notes=$2, reviewed_at=NOW() WHERE id=$1`,
        [claimId, adminNotes || null]
      );

      // Send email notification
      try {
        const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
        const ses = new SESClient({
          region: (process.env.AWS_REGION || "us-east-1").trim(),
          credentials: {
            accessKeyId: (process.env.AWS_ACCESS_KEY_ID || "").trim(),
            secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || "").trim(),
          },
        });
        await ses.send(new SendEmailCommand({
          Source: (process.env.AUTH_FROM_EMAIL || "noreply@cambridgetcg.com").trim(),
          Destination: { ToAddresses: [claim.rows[0].email] },
          Message: {
            Subject: { Data: "👑 Your OG Status is Active — Cambridge TCG" },
            Body: {
              Html: {
                Data: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background:#171717;border-radius:16px;">
    <h1 style="color:#fff;font-size:20px;margin:0 0 8px;">Cambridge <span style="color:#34d399;">TCG</span></h1>
    <div style="text-align:center;font-size:48px;margin:16px 0;">👑</div>
    <h2 style="color:#fff;font-size:18px;text-align:center;margin:0 0 16px;">Your OG Status is Active</h2>
    <p style="color:#a3a3a3;font-size:14px;">Welcome back, OG. Your purchase history has been verified and your permanent OG membership is now active.</p>
    <div style="background:#262626;border-radius:8px;padding:16px;margin:16px 0;font-size:13px;color:#d4d4d4;">
      <p style="margin:4px 0;">✓ 7% store discount</p>
      <p style="margin:4px 0;">✓ 7% cashback on cash</p>
      <p style="margin:4px 0;">✓ 7x points multiplier</p>
      <p style="margin:4px 0;">✓ 0% marketplace commission</p>
      <p style="margin:4px 0;">✓ 0% auction fees</p>
    </div>
    <a href="https://cambridgetcg.com/login" style="display:inline-block;padding:12px 32px;background:#f59e0b;color:#000;font-weight:700;text-decoration:none;border-radius:8px;font-size:14px;margin-top:8px;">Sign In to Your Account</a>
    <p style="color:#525252;font-size:12px;margin:24px 0 0;">You were here from the start. Thank you.</p>
  </div>
</body></html>`,
              },
              Text: { Data: "Your OG Status is active on Cambridge TCG. Sign in at https://cambridgetcg.com/login to access your perks." },
            },
          },
        }));
      } catch (e) { console.error("[og] Email failed:", e); }

      return NextResponse.json({ status: "approved", email: claim.rows[0].email });
    }

    if (body.action === "reject") {
      await query(
        `UPDATE og_claims SET status='rejected', admin_notes=$2, reviewed_at=NOW() WHERE id=$1`,
        [claimId, body.adminNotes || null]
      );
      return NextResponse.json({ status: "rejected" });
    }
  }

  // Public: submit claim
  const { email, platform, orderRef, username, notes } = body;

  if (!email?.trim() || !email.includes("@")) return NextResponse.json({ error: "Valid email required." }, { status: 400 });
  if (!platform) return NextResponse.json({ error: "Platform required." }, { status: 400 });
  if (!orderRef?.trim() && !username?.trim()) return NextResponse.json({ error: "Order reference or username required." }, { status: 400 });

  // Check for duplicate
  const existing = await query(
    `SELECT id, status FROM og_claims WHERE email=LOWER($1)`,
    [email]
  );
  if (existing.rows.length > 0) {
    const s = existing.rows[0].status;
    if (s === "approved") return NextResponse.json({ error: "OG status is already active for this email." }, { status: 400 });
    if (s === "pending") return NextResponse.json({ error: "You already have a pending claim. We'll review it within 1-2 business days." }, { status: 400 });
  }

  await query(
    `INSERT INTO og_claims (email, platform, order_ref, platform_username, notes) VALUES (LOWER($1),$2,$3,$4,$5)`,
    [email, platform, orderRef?.trim() || null, username?.trim() || null, notes?.trim() || null]
  );

  // Notify store
  try {
    const storeEmail = (process.env.STORE_NOTIFICATION_EMAIL || "contact@cambridgetcg.com").trim();
    const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
    const ses = new SESClient({
      region: (process.env.AWS_REGION || "us-east-1").trim(),
      credentials: {
        accessKeyId: (process.env.AWS_ACCESS_KEY_ID || "").trim(),
        secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || "").trim(),
      },
    });
    await ses.send(new SendEmailCommand({
      Source: (process.env.AUTH_FROM_EMAIL || "noreply@cambridgetcg.com").trim(),
      Destination: { ToAddresses: [storeEmail] },
      Message: {
        Subject: { Data: `New OG Claim: ${email} (${platform})` },
        Body: { Text: { Data: `OG claim from ${email}\nPlatform: ${platform}\nOrder: ${orderRef || "—"}\nUsername: ${username || "—"}\nNotes: ${notes || "—"}` } },
      },
    }));
  } catch { /* ignore */ }

  return NextResponse.json({ submitted: true });
}

// GET — admin: list claims
export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;

  let where = "";
  const params: unknown[] = [];
  if (status) { params.push(status); where = `WHERE status=$1`; }

  const result = await query(
    `SELECT * FROM og_claims ${where} ORDER BY created_at DESC`,
    params
  );
  return NextResponse.json({ claims: result.rows });
}
