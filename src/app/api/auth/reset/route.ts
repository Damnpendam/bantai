import { NextResponse } from "next/server";
import { createSession, openResetByToken, resetPassword } from "@/lib/auth";
import { api, clientIp, HttpError, jsonBody, setSessionCookie } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { userDto } from "@/lib/dto";

export const runtime = "nodejs";

/**
 * With only a token: reports whether the link is still good, so the page can
 * say so before the user types a new password. With a password too: sets it,
 * which signs out every other session, then signs this one in.
 */
export const POST = api(async (request: Request) => {
  const ip = clientIp(request);
  if (!rateLimit(`reset:ip:${ip}`, 20, 15 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  }
  const { token, password } = await jsonBody<{ token?: unknown; password?: unknown }>(request);
  if (typeof token !== "string" || !token) {
    throw new HttpError(400, "This page needs the link from your reset email.");
  }
  if (password === undefined) {
    return NextResponse.json({ valid: Boolean(openResetByToken(token)) });
  }

  const user = await resetPassword(token, typeof password === "string" ? password : "");
  const session = createSession(user.id, { userAgent: request.headers.get("user-agent"), ip });
  await setSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user: userDto(user) });
});
