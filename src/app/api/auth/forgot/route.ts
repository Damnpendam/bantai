import { NextResponse } from "next/server";
import { audit, createPasswordReset, isValidEmail, normalizeEmail } from "@/lib/auth";
import { api, appOrigin, clientIp, jsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { resetEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";

/**
 * Always answers the same way, whether or not the address has an account, and
 * doesn't wait on the email provider — so neither the response nor its timing
 * reveals who is registered.
 */
export const POST = api(async (request: Request) => {
  const { email } = await jsonBody<{ email?: unknown }>(request);
  const ok = NextResponse.json({ ok: true });
  if (!isValidEmail(email)) return ok;

  const window = 15 * 60 * 1000;
  const allowed =
    rateLimit(`forgot:ip:${clientIp(request)}`, 10, window).ok &&
    rateLimit(`forgot:email:${normalizeEmail(email)}`, 3, window).ok;
  if (!allowed) return ok;

  const reset = createPasswordReset(email);
  if (reset) {
    const link = `${appOrigin(request)}/reset#token=${reset.token}`;
    void sendEmail(resetEmail({ to: reset.user.email, link }));
    audit(reset.user.id, "password.reset_requested", null);
  }
  return ok;
});
