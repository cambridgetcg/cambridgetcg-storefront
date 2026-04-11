import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { getAllSubmissions, updateSubmissionStatus } from "@/lib/tradein/db";

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

    return NextResponse.json({ submission: updated });
  } catch (err) {
    console.error("[admin] Failed to update submission:", err);
    return NextResponse.json({ error: "Database error." }, { status: 500 });
  }
}
