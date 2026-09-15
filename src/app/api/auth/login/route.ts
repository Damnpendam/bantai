import { NextResponse } from "next/server";
import { authenticate, createSession, isValidEmail, normalizeEmail } from "@/lib/auth";
import { api, clientIp, HttpError, jsonBody, setSessionCookie } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { userDto } from "@/lib/dto";

export const runtime = "nodejs";

const WINDOW_MS = 15 * 60 * 1000;

export const POST = api(async (request: Request) => {
  const { email, password } = await jsonBody<{ email?: unknown; password?: unknown }>(request);
  if (!isValidEmail(email) || typeof password !== "string" || !password) {
    throw new HttpError(400, "Enter your email and password.");
  }
  const ip = clientIp(request);
  // Per address stops guessing one account's password; per IP stops spraying
  // one password across many accounts.
  const byEmail = rateLimit(`login:email:${normalizeEmail(email)}`, 8, WINDOW_MS);
  const byIp = rateLimit(`login:ip:${ip}`, 30, WINDOW_MS);
  if (!byEmail.ok || !byIp.ok) {
    throw new HttpError(429, "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  const user = await authenticate(email, password.slice(0, 200));
  if (!user) throw new HttpError(401, "That email and password don't match an account.");

  const { token, expiresAt } = createSession(user.id, {
    userAgent: request.headers.get("user-agent"),
    ip,
  });
  await setSessionCookie(token, expiresAt);
  return NextResponse.json({ user: userDto(user) });
});
