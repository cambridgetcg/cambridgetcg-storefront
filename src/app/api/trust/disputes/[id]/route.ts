import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { getDispute, resolveDispute, getDisputeMessages, getDisputeEvidence } from "@/lib/trust/db";
import { recordRefund } from "@/lib/trust/db";

// GET — dispute detail with messages and evidence
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const dispute = await getDispute(id);
  if (!dispute) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [messages, evidence] = await Promise.all([
    getDisputeMessages(id),
    getDisputeEvidence(id),
  ]);

  return NextResponse.json({ dispute, messages, evidence });
}

// PATCH — resolve dispute (admin)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json();

  if (!["refund_buyer", "release_seller", "split", "return_card"].includes(body.resolutionType)) {
    return NextResponse.json({ error: "Invalid resolution type." }, { status: 400 });
  }
  if (!body.resolutionNotes?.trim()) {
    return NextResponse.json({ error: "Resolution notes required." }, { status: 400 });
  }

  const dispute = await resolveDispute(id, {
    resolutionType: body.resolutionType,
    resolutionNotes: body.resolutionNotes.trim(),
    refundAmount: body.refundAmount,
  });

  // If refunding buyer, record the refund
  if (body.resolutionType === "refund_buyer" && body.refundAmount) {
    await recordRefund(dispute.trade_id, body.refundAmount, body.resolutionNotes.trim());
  }

  return NextResponse.json({ dispute });
}
