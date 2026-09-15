import { NextResponse } from "next/server";
import {
  getApiKey,
  getConfig,
  platformConfig,
  setApiKey,
  setConfig,
  usageToday,
} from "@/lib/settings";
import {
  EFFORTS,
  PROVIDER_LIST,
  getProvider,
  isProviderId,
  type Effort,
  type ProviderId,
} from "@/lib/providers";
import { isOwner } from "@/lib/auth";
import { api, HttpError, jsonBody, requireUser } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Settings of the caller's own workspace. Keys leave only as a four-character hint. */
function snapshot(workspaceId: string, canEdit: boolean) {
  const config = getConfig(workspaceId);
  const platform = platformConfig();
  return {
    ...config,
    canEdit,
    providers: PROVIDER_LIST.map((p) => {
      const key = getApiKey(workspaceId, p.id);
      return {
        id: p.id,
        label: p.label,
        keyUrl: p.keyUrl,
        keyPlaceholder: p.keyPlaceholder,
        defaultModel: p.defaultModel,
        fallbackModels: p.fallbackModels,
        hasKey: Boolean(key),
        keyHint: key ? `…${key.slice(-4)}` : null,
      };
    }),
    platform: platform
      ? {
          providerLabel: getProvider(platform.provider).label,
          model: platform.model,
          dailyRuns: platform.dailyRuns,
          dailyIngests: platform.dailyIngests,
          runsUsedToday: usageToday(workspaceId, "run"),
          ingestsUsedToday: usageToday(workspaceId, "ingest"),
        }
      : null,
  };
}

export const GET = api(async (_request: Request) => {
  const ctx = await requireUser();
  return NextResponse.json(snapshot(ctx.workspace.id, isOwner(ctx.user.id, ctx.workspace.id)));
});

export const POST = api(async (request: Request) => {
  const ctx = await requireUser();
  const workspaceId = ctx.workspace.id;
  if (!isOwner(ctx.user.id, workspaceId)) {
    throw new HttpError(403, "Only the workspace owner can change its settings.");
  }
  const body = await jsonBody<{
    provider?: unknown;
    apiKey?: unknown;
    apiKeyProvider?: unknown;
    model?: unknown;
    effort?: unknown;
    concurrency?: unknown;
  }>(request);

  if (body.provider !== undefined && (typeof body.provider !== "string" || !isProviderId(body.provider))) {
    throw new HttpError(400, "Unknown provider.");
  }
  if (body.effort !== undefined && !EFFORTS.includes(body.effort as Effort)) {
    throw new HttpError(400, "Unknown effort.");
  }
  if (body.concurrency !== undefined && !Number.isFinite(body.concurrency)) {
    throw new HttpError(400, "concurrency must be a number.");
  }
  if (body.model !== undefined && (typeof body.model !== "string" || body.model.length > 200)) {
    throw new HttpError(400, "Model must be a model id.");
  }

  // A key is always saved against a named provider, never the active one — the
  // user may be pasting a Gemini key while Anthropic is still selected.
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    // Verifying calls the provider; don't let this become a free key-checking oracle.
    if (!rateLimit(`verifykey:${ctx.user.id}`, 20, 60 * 60 * 1000).ok) {
      throw new HttpError(429, "Too many key checks this hour. Try again later.");
    }
    const target = body.apiKeyProvider ?? body.provider ?? getConfig(workspaceId).provider;
    if (typeof target !== "string" || !isProviderId(target)) {
      throw new HttpError(400, "Unknown provider.");
    }
    const apiKey = body.apiKey.trim().slice(0, 500);
    if (!(await getProvider(target).verifyKey(apiKey))) {
      throw new HttpError(400, `That key was rejected by ${getProvider(target).label}.`);
    }
    setApiKey(workspaceId, target as ProviderId, apiKey);
  }

  setConfig(workspaceId, {
    provider: body.provider as ProviderId | undefined,
    model: body.model as string | undefined,
    effort: body.effort as Effort | undefined,
    concurrency: body.concurrency as number | undefined,
  });

  return NextResponse.json(snapshot(workspaceId, true));
});
