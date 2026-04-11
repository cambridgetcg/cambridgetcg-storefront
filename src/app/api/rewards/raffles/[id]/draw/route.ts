import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { drawRaffleWinner, getRaffleEntries, updateRaffleStatus } from "@/lib/rewards/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  if (body.action === "draw") {
    const result = await drawRaffleWinner(id);
    return NextResponse.json(result);
  }

  if (body.action === "cancel") {
    await updateRaffleStatus(id, "cancelled");
    return NextResponse.json({ status: "cancelled" });
  }

  if (body.action === "activate") {
    await updateRaffleStatus(id, "active");
    return NextResponse.json({ status: "active" });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const entries = await getRaffleEntries(id);
  return NextResponse.json({ entries });
}
