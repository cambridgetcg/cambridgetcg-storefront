import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import {
  getAllSubmissions,
  updateSubmissionStatus,
  issueTradeinCreditIfDue,
  payTradeinCashIfDue,
} from "@/lib/tradein/db";
import { sendTradeinStatusEmail } from "@/lib/tradein/email";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const submissions = await getAllSubmissions();
    return NextResponse.json({ submissions });
  } catch (err) {
    console.error("[admin] Failed to fetch submissions:", err);
    return NextResponse.json({ error: "Database error." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { reference, status } = await request.json();
    const validStatuses = ["submitted", "received", "grading", "approved", "paid", "rejected", "cancelled"];

    if (!reference || !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid reference or status." }, { status: 400 });
    }

    const updated = await updateSubmissionStatus(reference, status);
    if (!updated) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    // On transition to 'paid', try BOTH legs of payout. Each is idempotent
    // (credit_issued_at and cash_paid_at gate re-runs), so admin can flip
    // status back and forth without double-paying. Cash leg requires
    // Stripe Connect onboarding; if absent, we fall back to manual.
    let creditResult: Awaited<ReturnType<typeof issueTradeinCreditIfDue>> | null = null;
    let cashResult: Awaited<ReturnType<typeof payTradeinCashIfDue>> | null = null;
    if (status === "paid") {
      try {
        creditResult = await issueTradeinCreditIfDue(reference);
      } catch (err) {
        console.error("[admin] Trade-in credit issuance failed:", err);
        creditResult = { ok: false, reason: "credit issuance threw" };
      }
      try {
        cashResult = await payTradeinCashIfDue(reference);
      } catch (err) {
        console.error("[admin] Trade-in cash payout failed:", err);
        cashResult = { ok: false, reason: "cash payout threw" };
      }
    }

    // Customer-facing email for visible milestones — fire-and-forget.
    // sendTradeinStatusEmail filters internally on supported statuses,
    // so unknown ones just no-op.
    if (updated.customer_email) {
      sendTradeinStatusEmail({
        email: updated.customer_email,
        reference: updated.reference,
        status,
      }).catch((err) => console.error("[admin] status email failed:", err));
    }

    return NextResponse.json({ submission: updated, credit: creditResult, cash: cashResult });
  } catch (err) {
    console.error("[admin] Failed to update submission:", err);
    return NextResponse.json({ error: "Database error." }, { status: 500 });
  }
}
