import { NextResponse } from "next/server";
import { listAudit, listInvites, listUsers } from "@/lib/auth";
import { api, requireAdmin } from "@/lib/http";
import { inviteDto, userDto } from "@/lib/dto";
import { platformConfig } from "@/lib/settings";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accounts and invites only. Deliberately nothing about any workspace's
 * projects, documents or runs — administering users is not a licence to read
 * their data.
 */
export const GET = api(async (_request: Request) => {
  const ctx = await requireAdmin();
  const users = listUsers();
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const platform = platformConfig();
  return NextResponse.json({
    me: ctx.user.id,
    users: users.map(userDto),
    invites: listInvites(100).map(inviteDto),
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    platform: platform
      ? {
          provider: getProvider(platform.provider).label,
          model: platform.model,
          dailyRuns: platform.dailyRuns,
          dailyIngests: platform.dailyIngests,
        }
      : null,
    audit: listAudit(50).map((entry) => ({
      id: entry.id,
      actor: entry.actorId ? (emailById.get(entry.actorId) ?? "deleted user") : "system",
      action: entry.action,
      target: entry.target,
      createdAt: entry.createdAt,
    })),
  });
});
