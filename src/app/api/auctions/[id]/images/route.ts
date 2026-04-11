import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { addAuctionImage, removeAuctionImage } from "@/lib/auction/db";
import { deleteS3Object } from "@/lib/auction/s3";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const { url, s3Key, order } = await req.json();
    if (!url || !s3Key) {
      return NextResponse.json({ error: "url and s3Key are required" }, { status: 400 });
    }
    const image = await addAuctionImage(id, url, s3Key, order ?? 0);
    return NextResponse.json(image, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await params; // consume params
  try {
    const { imageId } = await req.json();
    if (!imageId) {
      return NextResponse.json({ error: "imageId is required" }, { status: 400 });
    }
    const s3Key = await removeAuctionImage(imageId);
    if (s3Key) {
      await deleteS3Object(s3Key);
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to remove image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
