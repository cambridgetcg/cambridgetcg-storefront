import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { updateEscrowStatus } from "@/lib/market/db";

// PATCH — admin: update escrow status
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  if (!body.status) {
    return NextResponse.json({ error: "Status required." }, { status: 400 });
  }

  const trade = await updateEscrowStatus(id, body.status, {
    trackingToCtcg: body.trackingToCtcg,
    trackingToBuyer: body.trackingToBuyer,
    adminNotes: body.adminNotes,
  });

  if (!trade) {
    return NextResponse.json({ error: "Trade not found." }, { status: 404 });
  }

  return NextResponse.json({ trade });
}
