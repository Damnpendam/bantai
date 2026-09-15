import { NextResponse } from "next/server";
import { revokeSession } from "@/lib/auth";
import { api, clearSessionCookie, sessionToken } from "@/lib/http";

export const runtime = "nodejs";

/** Ends the session server-side, not just the cookie — a copied cookie dies too. */
export const POST = api(async (_request: Request) => {
  revokeSession(await sessionToken());
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
