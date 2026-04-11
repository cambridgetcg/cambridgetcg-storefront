import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMemberProfile, getAllTiers } from "@/lib/membership/db";

// GET — member profile with tier, points, perks, progress
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Public: list tiers
  if (url.searchParams.get("tiers") === "true") {
    const tiers = await getAllTiers();
    return NextResponse.json({ tiers });
  }

  // Authenticated: full member profile
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const profile = await getMemberProfile(session.user.id);
  return NextResponse.json({ profile });
}
