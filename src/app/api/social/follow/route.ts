import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toggleFollow } from "@/lib/social/db";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: "User ID required." }, { status: 400 });

  const following = await toggleFollow(session.user.id, userId);
  return NextResponse.json({ following });
}
