import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { getPresignedUploadUrl } from "@/lib/auction/s3";

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { auctionId, contentType } = await req.json();
    if (!auctionId || !contentType) {
      return NextResponse.json({ error: "auctionId and contentType are required" }, { status: 400 });
    }
    const result = await getPresignedUploadUrl(auctionId, contentType);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
