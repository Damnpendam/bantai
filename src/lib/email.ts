/**
 * Outgoing email over Resend's HTTP API — a plain fetch, no SDK. Without
 * RESEND_API_KEY nothing is sent; the message is logged instead, and the admin
 * page shows the invite link so it can be passed on by hand. That keeps a fresh
 * deploy usable before email is set up.
 */

export interface EmailResult {
  delivered: boolean;
  reason?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.info(
      `[email] not sent (set RESEND_API_KEY and EMAIL_FROM to deliver)\n  to: ${message.to}\n  subject: ${message.subject}\n\n${message.text}\n`,
    );
    return { delivered: false, reason: "Email isn't configured on this server." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[email] Resend rejected the message (${response.status}): ${body.slice(0, 300)}`);
      return { delivered: false, reason: `The email provider rejected it (${response.status}).` };
    }
    return { delivered: true };
  } catch (error) {
    console.error("[email] send failed", error);
    return { delivered: false, reason: "Couldn't reach the email provider." };
  }
}

function layout(heading: string, body: string, link: string, cta: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1a17;background:#fbfaf9;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e3dd;border-radius:12px;padding:28px">
<h1 style="font-size:18px;margin:0 0 12px">${heading}</h1>
<p style="font-size:14px;line-height:1.5;color:#57534e;margin:0 0 20px">${body}</p>
<a href="${escapeHtml(link)}" style="display:inline-block;background:#534ab7;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">${cta}</a>
<p style="font-size:12px;color:#8c867e;margin:20px 0 0">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
</div></body></html>`;
}

export function inviteEmail(input: {
  to: string;
  link: string;
  inviterName: string | null;
  role: "superadmin" | "member";
}) {
  const who = input.inviterName ? `${input.inviterName} has invited you` : "You've been invited";
  const what =
    input.role === "superadmin"
      ? "to set up Bantai as its administrator"
      : "to Bantai, where you can turn requirement documents into test suites";
  return {
    to: input.to,
    subject: input.role === "superadmin" ? "Set up your Bantai admin account" : "You're invited to Bantai",
    text: `${who} ${what}.\n\nCreate your account: ${input.link}\n\nThis link works once and expires in 7 days.`,
    html: layout(
      "You're invited to Bantai",
      `${escapeHtml(who)} ${escapeHtml(what)}. This link works once and expires in 7 days.`,
      input.link,
      "Create your account",
    ),
  };
}

export function resetEmail(input: { to: string; link: string }) {
  return {
    to: input.to,
    subject: "Reset your Bantai password",
    text: `Someone asked to reset the password for this account.\n\nSet a new one: ${input.link}\n\nThis link expires in an hour. If it wasn't you, ignore this email — nothing changes.`,
    html: layout(
      "Reset your password",
      "Someone asked to reset the password for this account. This link expires in an hour. If it wasn't you, ignore this email — nothing changes.",
      input.link,
      "Set a new password",
    ),
  };
}
