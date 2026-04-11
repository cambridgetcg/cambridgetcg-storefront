import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addToShowcase, removeFromShowcase, getShowcase } from "@/lib/social/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const showcase = await getShowcase(session.user.id);
  return NextResponse.json({ showcase });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { portfolioCardId, caption } = await request.json();
  if (!portfolioCardId) return NextResponse.json({ error: "Card ID required." }, { status: 400 });
  await addToShowcase(session.user.id, portfolioCardId, caption);
  return NextResponse.json({ added: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { portfolioCardId } = await request.json();
  await removeFromShowcase(session.user.id, portfolioCardId);
  return NextResponse.json({ removed: true });
}
