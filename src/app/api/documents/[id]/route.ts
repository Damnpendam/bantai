import { NextResponse } from "next/server";
import { deleteDocument } from "@/lib/store";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteDocument(id);
  return NextResponse.json({ ok: true });
}
