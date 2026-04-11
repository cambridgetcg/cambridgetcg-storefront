import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWishlist, addToWishlist, removeFromWishlist } from "@/lib/social/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const wishlist = await getWishlist(session.user.id);
  return NextResponse.json({ wishlist });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await request.json();
  if (!body.cardName?.trim()) return NextResponse.json({ error: "Card name required." }, { status: 400 });

  const item = await addToWishlist(session.user.id, {
    sku: body.sku,
    cardName: body.cardName.trim(),
    cardNumber: body.cardNumber,
    setCode: body.setCode,
    setName: body.setName,
    imageUrl: body.imageUrl,
    maxPrice: body.maxPrice,
    conditionMin: body.conditionMin,
    notes: body.notes,
  });

  return NextResponse.json({ item });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { itemId } = await request.json();
  await removeFromWishlist(session.user.id, itemId);
  return NextResponse.json({ removed: true });
}
