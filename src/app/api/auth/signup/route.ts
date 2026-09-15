import { NextResponse } from "next/server";
import { acceptInvite, createSession } from "@/lib/auth";
import { api, clientIp, HttpError, jsonBody, setSessionCookie } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { userDto } from "@/lib/dto";

export const runtime = "nodejs";

/** Invite-only: there is no way to create an account without a valid token. */
export const POST = api(async (request: Request) => {
  const ip = clientIp(request);
  if (!rateLimit(`signup:ip:${ip}`, 20, 15 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  }
  const { token, name, password } = await jsonBody<{
    token?: unknown;
    name?: unknown;
    password?: unknown;
  }>(request);
  if (typeof token !== "string" || !token) {
    throw new HttpError(400, "This page needs the link from your invite email.");
  }

  const user = await acceptInvite(token, {
    name: typeof name === "string" ? name : "",
    password: typeof password === "string" ? password : "",
  });

  const session = createSession(user.id, { userAgent: request.headers.get("user-agent"), ip });
  await setSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user: userDto(user) });
});
