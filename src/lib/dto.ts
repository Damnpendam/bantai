import type { Invite, User, Workspace } from "@/lib/auth";

/**
 * What leaves the server about accounts. Explicit fields only — never the raw
 * row, which carries the password hash.
 */

export function userDto(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    disabledAt: user.disabledAt,
  };
}

export function workspaceDto(workspace: Workspace) {
  return { id: workspace.id, name: workspace.name };
}

export function inviteDto(invite: Invite) {
  const now = Date.now();
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    status: invite.acceptedAt
      ? "accepted"
      : invite.revokedAt
        ? "revoked"
        : invite.expiresAt <= now
          ? "expired"
          : "pending",
  } as const;
}
