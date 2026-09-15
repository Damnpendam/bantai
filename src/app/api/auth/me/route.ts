import { NextResponse } from "next/server";
import { api, requireUser } from "@/lib/http";
import { userDto, workspaceDto } from "@/lib/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = api(async (_request: Request) => {
  const ctx = await requireUser();
  return NextResponse.json({ user: userDto(ctx.user), workspace: workspaceDto(ctx.workspace) });
});
