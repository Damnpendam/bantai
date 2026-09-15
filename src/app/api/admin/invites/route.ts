import { NextResponse } from "next/server";
import { audit, createInvite } from "@/lib/auth";
import { api, appOrigin, HttpError, jsonBody, requireAdmin } from "@/lib/http";
import { inviteEmail, sendEmail } from "@/lib/email";
import { inviteDto } from "@/lib/dto";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * The only way anyone gets an account. The link goes out by email; it's also
 * returned to the admin, so an unconfigured or failed email doesn't block the
 * invite — it can be passed on by hand.
 */
export const POST = api(async (request: Request) => {
  const ctx = await requireAdmin();
  if (!rateLimit(`invite:admin:${ctx.user.id}`, 60, 60 * 60 * 1000).ok) {
    throw new HttpError(429, "That's a lot of invites in an hour. Try again shortly.");
  }
  const { email, role } = await jsonBody<{ email?: unknown; role?: unknown }>(request);
  if (role !== undefined && role !== "member" && role !== "superadmin") {
    throw new HttpError(400, "Role must be member or superadmin.");
  }

  const { invite, token } = createInvite({
    email: typeof email === "string" ? email : "",
    role: role === "superadmin" ? "superadmin" : "member",
    invitedBy: ctx.user.id,
  });
  const link = `${appOrigin(request)}/signup#token=${token}`;
  const sent = await sendEmail(
    inviteEmail({ to: invite.email, link, inviterName: ctx.user.name, role: invite.role }),
  );
  audit(ctx.user.id, invite.role === "superadmin" ? "invite.sent_admin" : "invite.sent", invite.email);

  return NextResponse.json({
    invite: inviteDto(invite),
    link,
    emailed: sent.delivered,
    emailError: sent.reason ?? null,
  });
});
