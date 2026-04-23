import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sellBackVaultItem } from "@/lib/bounty/db";
import { addCredit } from "@/lib/membership/db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { id } = await params;

  const result = await sellBackVaultItem(id, session.user.id);
  if ("error" in result) {
    return NextResponse.json(result, { status: 409 });
  }

  await addCredit(
    session.user.id,
    result.creditAwarded,
    "bounty_sellback",
    `Bounty sell-back: ${result.item.card_name} (${result.item.sku})`,
    result.item.id,
  );

  return NextResponse.json({
    item: result.item,
    creditAwarded: result.creditAwarded,
  });
}
