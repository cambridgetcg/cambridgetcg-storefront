import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin/auth";
import { submitVerification, getVerification, listPendingVerifications, listAllVerifications, approveVerification, rejectVerification } from "@/lib/trust/db";
import { UK_POSTCODE_REGEX } from "@/lib/trust/types";

// GET — user's verification status, or admin list
export async function GET(request: Request) {
  const url = new URL(request.url);
  const admin = url.searchParams.get("admin") === "true";

  if (admin) {
    if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const pending = url.searchParams.get("pending") === "true";
    const verifications = pending ? await listPendingVerifications() : await listAllVerifications();
    return NextResponse.json({ verifications });
  }

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const verification = await getVerification(session.user.id);
  return NextResponse.json({ verification });
}

// POST — submit verification (customer) or approve/reject (admin)
export async function POST(request: Request) {
  const body = await request.json();

  // Admin actions
  if (body.action === "approve" || body.action === "reject") {
    if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (body.action === "approve") {
      await approveVerification(body.userId, body.notes);
      return NextResponse.json({ status: "verified" });
    } else {
      if (!body.reason) return NextResponse.json({ error: "Rejection reason required." }, { status: 400 });
      await rejectVerification(body.userId, body.reason);
      return NextResponse.json({ status: "rejected" });
    }
  }

  // Customer submission
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (!body.fullLegalName?.trim()) return NextResponse.json({ error: "Full legal name required." }, { status: 400 });
  if (!body.dateOfBirth) return NextResponse.json({ error: "Date of birth required." }, { status: 400 });
  if (!body.addressLine1?.trim()) return NextResponse.json({ error: "Address required." }, { status: 400 });
  if (!body.city?.trim()) return NextResponse.json({ error: "City required." }, { status: 400 });
  if (!body.postcode?.trim()) return NextResponse.json({ error: "Postcode required." }, { status: 400 });
  if (!UK_POSTCODE_REGEX.test(body.postcode.trim())) return NextResponse.json({ error: "Enter a valid UK postcode." }, { status: 400 });

  // 18+ check
  const dob = new Date(body.dateOfBirth);
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (age < 18) return NextResponse.json({ error: "You must be 18 or over to trade P2P." }, { status: 400 });

  const verification = await submitVerification(session.user.id, {
    fullLegalName: body.fullLegalName.trim(),
    dateOfBirth: body.dateOfBirth,
    addressLine1: body.addressLine1.trim(),
    addressLine2: body.addressLine2?.trim(),
    city: body.city.trim(),
    county: body.county?.trim(),
    postcode: body.postcode.trim(),
    phone: body.phone?.trim(),
    bankSortCode: body.bankSortCode?.trim(),
    bankAccountNumber: body.bankAccountNumber?.trim(),
    bankAccountName: body.bankAccountName?.trim(),
  });

  return NextResponse.json({ verification });
}
