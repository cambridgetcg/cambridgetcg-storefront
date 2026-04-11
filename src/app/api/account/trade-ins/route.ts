import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subs = await query(
    `SELECT * FROM tradein_submissions WHERE customer_email = $1 ORDER BY created_at DESC`,
    [session.user.email]
  );

  const submissions = [];
  for (const sub of subs.rows) {
    const items = await query(
      `SELECT * FROM tradein_items WHERE submission_id = $1 ORDER BY id`,
      [sub.id]
    );
    submissions.push({ submission: sub, items: items.rows });
  }

  return NextResponse.json({ submissions });
}
