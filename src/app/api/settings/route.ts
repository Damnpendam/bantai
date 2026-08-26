import { NextResponse } from "next/server";
import { getApiKey, getConfig, setApiKey, setConfig } from "@/lib/settings";
import {
  EFFORTS,
  PROVIDER_LIST,
  getProvider,
  isProviderId,
  type Effort,
  type ProviderId,
} from "@/lib/providers";

export const runtime = "nodejs";

function snapshot() {
  const config = getConfig();
  return {
    ...config,
    providers: PROVIDER_LIST.map((p) => {
      const key = getApiKey(p.id);
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
  };
}

export async function GET() {
  return NextResponse.json(snapshot());
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    provider?: string;
    apiKey?: string;
    apiKeyProvider?: string;
    model?: string;
    effort?: string;
    concurrency?: number;
  };

  // A key is always saved against a named provider, never the active one — the
  // user may be pasting a Gemini key while Anthropic is still selected.
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    const target = body.apiKeyProvider ?? body.provider ?? getConfig().provider;
    if (!isProviderId(target)) {
      return NextResponse.json({ error: `Unknown provider "${target}".` }, { status: 400 });
    }
    const apiKey = body.apiKey.trim();
    if (!(await getProvider(target).verifyKey(apiKey))) {
      return NextResponse.json(
        { error: `That key was rejected by ${getProvider(target).label}.` },
        { status: 400 },
      );
    }
    setApiKey(target as ProviderId, apiKey);
  }

  if (body.provider && !isProviderId(body.provider)) {
    return NextResponse.json({ error: `Unknown provider "${body.provider}".` }, { status: 400 });
  }
  if (body.effort && !EFFORTS.includes(body.effort as Effort)) {
    return NextResponse.json({ error: `Unknown effort "${body.effort}".` }, { status: 400 });
  }

  if (body.concurrency !== undefined && !Number.isFinite(body.concurrency)) {
    return NextResponse.json({ error: "concurrency must be a number." }, { status: 400 });
  }

  setConfig({
    provider: body.provider as ProviderId | undefined,
    model: body.model,
    effort: body.effort as Effort | undefined,
    concurrency: body.concurrency,
  });

  return NextResponse.json(snapshot());
}
