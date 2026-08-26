import { NextResponse } from "next/server";
import { getApiKey } from "@/lib/settings";
import { getProvider, isProviderId } from "@/lib/providers";

export const runtime = "nodejs";

/**
 * Live model list for a provider. Model line-ups move faster than this app ships,
 * so the picker asks the provider rather than trusting a hardcoded list.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("provider") ?? "";
  if (!isProviderId(id)) {
    return NextResponse.json({ error: `Unknown provider "${id}".` }, { status: 400 });
  }
  const provider = getProvider(id);
  const apiKey = getApiKey(id);
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
}
