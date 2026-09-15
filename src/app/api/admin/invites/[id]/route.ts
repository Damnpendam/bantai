import { NextResponse } from "next/server";
import { audit, getUserById, reissueInvite, revokeInvite } from "@/lib/auth";
import { api, appOrigin, HttpError, jsonBody, requireAdmin } from "@/lib/http";
import { inviteEmail, sendEmail } from "@/lib/email";
import { inviteDto } from "@/lib/dto";

export const runtime = "nodejs";

/** { action: "revoke" } kills the link; { action: "resend" } replaces it with a fresh one. */
export const POST = api(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireAdmin();
    const { id } = await params;
    const { action } = await jsonBody<{ action?: unknown }>(request);

    if (action === "revoke") {
      const invite = revokeInvite(id);
      audit(ctx.user.id, "invite.revoked", invite.email);
      return NextResponse.json({ invite: inviteDto(invite) });
    }

    if (action === "resend") {
      const { invite, token } = reissueInvite(id);
      const link = `${appOrigin(request)}/signup#token=${token}`;
      const inviter = invite.invitedBy ? getUserById(invite.invitedBy) : null;
      const sent = await sendEmail(
        inviteEmail({
          to: invite.email,
          link,
          inviterName: inviter?.name ?? ctx.user.name,
          role: invite.role,
        }),
      );
      audit(ctx.user.id, "invite.resent", invite.email);
      return NextResponse.json({
        invite: inviteDto(invite),
        link,
        emailed: sent.delivered,
        emailError: sent.reason ?? null,
      });
    }

    throw new HttpError(400, 'action must be "revoke" or "resend".');
  },
);
