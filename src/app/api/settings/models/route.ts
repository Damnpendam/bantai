import { NextResponse } from "next/server";
import { getApiKey } from "@/lib/settings";
import { getProvider, isProviderId } from "@/lib/providers";
import { api, HttpError, requireUser } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live model list for a provider, using the caller's workspace key. Model
 * line-ups move faster than this app ships, so the picker asks the provider
 * rather than trusting a hardcoded list.
 */
export const GET = api(async (request: Request) => {
  const ctx = await requireUser();
  const id = new URL(request.url).searchParams.get("provider") ?? "";
  if (!isProviderId(id)) throw new HttpError(400, "Unknown provider.");
  const provider = getProvider(id);
  const apiKey = getApiKey(ctx.workspace.id, id);
  if (!apiKey && provider.listNeedsKey) {
    return NextResponse.json({ models: provider.fallbackModels, live: false });
  }
  try {
    const models = await provider.listModels(apiKey ?? "");
    return NextResponse.json({
      models: models.length > 0 ? models : provider.fallbackModels,
      live: models.length > 0,
    });
  } catch {
    return NextResponse.json({ models: provider.fallbackModels, live: false });
  }
});
