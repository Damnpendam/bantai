import fs from "node:fs";
import { hasSuperadmin, issueBootstrapInvite } from "@/lib/auth";
import { encrypt } from "@/lib/secrets";
import { inviteEmail, sendEmail } from "@/lib/email";
import { appOrigin } from "@/lib/http";
import { dataDir } from "@/lib/data-dir";

/**
 * The two ways a first deploy silently goes wrong: the database directory
 * isn't writable (a volume owned by root, an image running as non-root), or
 * it isn't a volume at all and everything vanishes on the next deploy.
 * Returns false when the database can't be used.
 */
function checkStorage(): boolean {
  const dir = dataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    console.error(
      `[bootstrap] Can't write to ${dir}, where the database lives. On Railway, set RAILWAY_RUN_UID=0 so the app can write to the attached volume; elsewhere, make ${dir} writable by the app's user.`,
    );
    return false;
  }
  if (process.env.NODE_ENV === "production" && process.platform === "linux") {
    try {
      // A mounted volume is a different device from the container's root.
      if (fs.statSync(dir).dev === fs.statSync("/").dev) {
        console.warn(
          `[bootstrap] ${dir} is not a mounted volume — the database will be lost on the next deploy. Attach a persistent volume at ${dir}.`,
        );
      }
    } catch {
      // Can't tell; say nothing rather than something wrong.
    }
  }
  return true;
}

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
  if (!checkStorage()) return;
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
