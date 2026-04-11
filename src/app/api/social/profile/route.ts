import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPublicProfile, updateProfile, getShowcase, getUserActivity } from "@/lib/social/db";
import { getWishlist } from "@/lib/social/db";
import { getUserAchievements } from "@/lib/social/db";
import { isFollowing } from "@/lib/social/db";

// GET — public profile by username/id, or own profile
export async function GET(request: Request) {
  const url = new URL(request.url);
  const identifier = url.searchParams.get("user");
  const session = await auth();

  const targetId = identifier || session?.user?.id;
  if (!targetId) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const profile = await getPublicProfile(targetId);
  if (!profile) return NextResponse.json({ error: "User not found." }, { status: 404 });

  if (!profile.is_public && profile.user_id !== session?.user?.id) {
    return NextResponse.json({ error: "Profile is private." }, { status: 403 });
  }

  const [showcase, wishlist, activity, achievements] = await Promise.all([
    getShowcase(profile.user_id),
    getWishlist(profile.user_id),
    getUserActivity(profile.user_id, 10),
    getUserAchievements(profile.user_id),
  ]);

  let following = false;
  if (session?.user?.id && session.user.id !== profile.user_id) {
    following = await isFollowing(session.user.id, profile.user_id);
  }

  return NextResponse.json({ profile, showcase, wishlist, activity, achievements, following });
}

// PATCH — update own profile
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await request.json();
  await updateProfile(session.user.id, {
    username: body.username,
    bio: body.bio,
    avatarUrl: body.avatarUrl,
    isPublic: body.isPublic,
  });

  return NextResponse.json({ updated: true });
}
