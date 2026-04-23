import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import {
  getAllSubmissions,
  updateSubmissionStatus,
  issueTradeinCreditIfDue,
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

    // On transition to 'paid', issue store credit if the submission has a
    // credit component + linked user. Idempotent (credit_issued_at column
    // gates re-runs); admin can flip status back and forth without
    // double-crediting.
    let creditResult: Awaited<ReturnType<typeof issueTradeinCreditIfDue>> | null = null;
    if (status === "paid") {
      try {
        creditResult = await issueTradeinCreditIfDue(reference);
      } catch (err) {
        console.error("[admin] Trade-in credit issuance failed:", err);
        creditResult = { ok: false, reason: "credit issuance threw" };
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

    return NextResponse.json({ submission: updated, credit: creditResult });
  } catch (err) {
    console.error("[admin] Failed to update submission:", err);
    return NextResponse.json({ error: "Database error." }, { status: 500 });
  }
}
