import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin/auth";
import { getUserTrades, getAllTrades } from "@/lib/market/db";

// GET — user's trades (or admin: all trades)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const admin = url.searchParams.get("admin") === "true";

  if (admin) {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const escrowStatus = url.searchParams.get("escrow") || undefined;
    const trades = await getAllTrades(escrowStatus);
    return NextResponse.json({ trades });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const trades = await getUserTrades(session.user.id);
  return NextResponse.json({ trades });
}
