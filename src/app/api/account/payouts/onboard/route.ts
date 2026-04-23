import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrCreateAccount, createOnboardingLink } from "@/lib/payouts/stripe-connect";

// POST — start (or continue) Stripe Connect onboarding.
// Returns a hosted onboarding URL the client should redirect to. Stripe
// links expire quickly, so we always mint a fresh one per click rather
// than caching.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  try {
    const accountId = await getOrCreateAccount(session.user.id, session.user.email);
    const url = await createOnboardingLink(accountId);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[payouts] Onboarding link error:", err);
    const msg = err instanceof Error ? err.message : "Failed to start onboarding";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
