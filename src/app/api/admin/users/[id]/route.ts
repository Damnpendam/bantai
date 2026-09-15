import { NextResponse } from "next/server";
import { audit, setUserDisabled } from "@/lib/auth";
import { api, HttpError, jsonBody, requireAdmin } from "@/lib/http";
import { userDto } from "@/lib/dto";

export const runtime = "nodejs";

/** Disable or re-enable an account. Disabling signs them out everywhere at once. */
export const POST = api(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireAdmin();
    const { id } = await params;
    const { disabled } = await jsonBody<{ disabled?: unknown }>(request);
    if (typeof disabled !== "boolean") {
      throw new HttpError(400, "disabled must be true or false.");
    }
    if (disabled && id === ctx.user.id) {
      throw new HttpError(400, "You can't disable your own account.");
    }
    const user = setUserDisabled(id, disabled);
    audit(ctx.user.id, disabled ? "user.disabled" : "user.enabled", user.email);
    return NextResponse.json({ user: userDto(user) });
  },
);
