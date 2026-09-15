import { hasSuperadmin, issueBootstrapInvite } from "@/lib/auth";
import { encrypt } from "@/lib/secrets";
import { inviteEmail, sendEmail } from "@/lib/email";
import { appOrigin } from "@/lib/http";

/**
 * Runs once per server start (from instrumentation.ts).
 *
 * 1. Fails loudly if the encryption secret is unusable, at boot rather than on
 *    the first request that touches a stored key.
 * 2. Until a super admin exists, issues SUPERADMIN_EMAIL a fresh invite and
 *    logs the link. Only that inbox and the server log see it, so nobody who
 *    merely reaches a fresh deploy can claim the instance.
 */
export async function bootstrap(): Promise<void> {
  try {
    encrypt("probe");
  } catch (error) {
    console.error(`[bootstrap] ${error instanceof Error ? error.message : error}`);
    return;
  }

  try {
    if (hasSuperadmin()) return;
    const email = process.env.SUPERADMIN_EMAIL?.trim();
    if (!email) {
      console.warn(
        "[bootstrap] No super admin exists yet. Set SUPERADMIN_EMAIL and restart to receive the setup link.",
      );
      return;
    }
    const issued = issueBootstrapInvite(email);
    if (!issued) return;
    const link = `${appOrigin()}/signup#token=${issued.token}`;
    console.info(
      `[bootstrap] Super admin setup link for ${issued.invite.email}:\n\n  ${link}\n\n  Works once, expires in 7 days. A fresh link is issued on every start until the account exists.`,
    );
    await sendEmail(
      inviteEmail({ to: issued.invite.email, link, inviterName: null, role: "superadmin" }),
    );
  } catch (error) {
    console.error("[bootstrap] failed", error);
  }
}
