import { NextResponse } from "next/server";
import { openInviteByToken } from "@/lib/auth";
import { api, clientIp, HttpError, jsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Looks up an invite so the signup page can show who it's for. POST, with the
 * token in the body: it never appears in a URL, a server log, or a Referer.
 */
export const POST = api(async (request: Request) => {
  if (!rateLimit(`invite:ip:${clientIp(request)}`, 30, 15 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  }
  const { token } = await jsonBody<{ token?: unknown }>(request);
  const invite = typeof token === "string" ? openInviteByToken(token) : null;
  if (!invite) {
    throw new HttpError(404, "This invite link is invalid, expired, or already used.");
  }
  return NextResponse.json({ email: invite.email, role: invite.role });
});
