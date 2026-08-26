import OpenAI from "openai";
import {
  LlmError,
  parseRetryAfter,
  type Effort,
  type JsonRequest,
  type ModelOption,
  type Provider,
} from "./types";

const BASE_URL = "https://openrouter.ai/api/v1";

// OpenRouter passes `reasoning` through to models that support it and ignores it
// elsewhere. Three levels against our five.
const REASONING: Record<Effort, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

/**
 * Strict structured output accepts only a subset of JSON Schema — numeric and
 * length constraints are rejected outright rather than ignored. Drop them here so
 * the canonical agent schemas stay expressive for providers that do accept them.
 */
const UNSUPPORTED = new Set([
  "minItems", "maxItems", "minimum", "maximum",
  "minLength", "maxLength", "pattern", "default", "examples",
]);

function forStrictMode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forStrictMode);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (UNSUPPORTED.has(key)) continue;
      out[key] = forStrictMode(child);
    }
    return out;
  }
  return value;
}

function client(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    maxRetries: 3,
    defaultHeaders: { "X-Title": "Bantai" },
  });
}

function apiMessage(error: { error?: unknown; message: string }): string {
  const body = error.error as { message?: string } | undefined;
  return body?.message ?? error.message;
}

function describe(error: unknown): LlmError {
  if (error instanceof OpenAI.APIError) {
    const message = apiMessage(error);
    if (error.status === 401) {
      return new LlmError("The OpenRouter API key was rejected. Check it in settings.", false);
    }
    if (error.status === 402) {
      return new LlmError(
        `Not enough OpenRouter credit for this model. Add credit at openrouter.ai/credits, or pick a cheaper model in settings. (${message})`,
        false,
      );
    }
    if (error.status === 404) {
      return new LlmError(
        `${message} Open settings and pick a model — the list is loaded live from OpenRouter.`,
        false,
      );
    }
    if (error.status === 429) {
      const after = parseRetryAfter(error.headers?.get?.("retry-after"));
      return new LlmError("Rate limited by OpenRouter.", true, after);
    }
    if (error.status === 400) {
      return new LlmError(`OpenRouter rejected the request: ${message}`, false);
    }
    return new LlmError(
      `OpenRouter error ${error.status ?? "?"}: ${message}`,
      (error.status ?? 0) >= 500,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LlmError(message, /fetch failed|ECONN|network|timeout/i.test(message));
}

/** Free models cap output far below what the writer agents request. */
function isTokenCeiling(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error.status !== 400 && error.status !== 422) return false;
  return /max_tokens|maximum.{0,20}token|token.{0,20}limit|context length/i.test(
    apiMessage(error),
  );
}

const SMALL_MODEL_CEILING = 8192;

/** Not every model behind OpenRouter honours json_schema, even when advertised. */
function isSchemaUnsupported(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error.status !== 400 && error.status !== 404 && error.status !== 422) return false;
  return /response_format|json_schema|structured|schema/i.test(apiMessage(error));
}

export const openrouterProvider: Provider = {
  id: "openrouter",
  label: "OpenRouter",
  keyUrl: "https://openrouter.ai/keys",
  keyPlaceholder: "sk-or-v1-…",
  defaultModel: "deepseek/deepseek-v4-flash",
  listNeedsKey: false,
  fallbackModels: [
    { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash — cheap" },
    { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "z-ai/glm-5.2:free", label: "GLM 5.2 (free)" },
  ],

  async json(apiKey, model, request: JsonRequest): Promise<string> {
    const ai = client(apiKey);
    const schema = forStrictMode(request.schema) as Record<string, unknown>;

    const call = async (useSchema: boolean, maxTokens: number): Promise<string> => {
      // Models without json_schema support still follow an inlined schema reliably
      // enough, given json_object mode guarantees parseable output.
      const system = useSchema
        ? request.system
        : `${request.system}\n\nReply with a single JSON object matching this schema exactly. Output nothing but the JSON.\n\n${JSON.stringify(schema)}`;

      const stream = await ai.chat.completions.create(
        {
          model,
          stream: true,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: request.prompt },
          ],
          response_format: useSchema
            ? {
                type: "json_schema",
                json_schema: { name: "result", strict: true, schema },
              }
            : { type: "json_object" },
          // Passed through by OpenRouter; ignored by models without reasoning.
          reasoning: { effort: REASONING[request.effort] },
        } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal: request.signal },
      );

      let text = "";
      let finish: string | null = null;
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) {
          text += delta;
          request.onToken?.(delta);
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }

      if (finish === "length") {
        throw new LlmError(
          "The response hit the token ceiling before finishing. Lower the target case count for this agent.",
          false,
        );
      }
      if (finish === "content_filter") {
        throw new LlmError("The model's provider filtered this request.", false);
      }
      if (!text.trim()) {
        throw new LlmError(
          "OpenRouter returned an empty response. The model may not support structured output — try another in settings.",
          true,
        );
      }
      return text;
    };

    const rescue = async (useSchema: boolean, maxTokens: number): Promise<string> =>
      call(useSchema, maxTokens).catch((error) => {
        throw error instanceof LlmError ? error : describe(error);
      });

    try {
      return await call(true, request.maxTokens);
    } catch (error) {
      if (isSchemaUnsupported(error)) {
        return rescue(false, request.maxTokens);
      }
      if (isTokenCeiling(error)) {
        return rescue(true, Math.min(request.maxTokens, SMALL_MODEL_CEILING));
      }
      throw error instanceof LlmError ? error : describe(error);
    }
  },

  async verifyKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${BASE_URL}/key`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async listModels(): Promise<ModelOption[]> {
    // Public endpoint — the picker works before a key is saved.
    const response = await fetch(`${BASE_URL}/models`);
    if (!response.ok) return [];
    const body = (await response.json()) as {
      data?: {
        id: string;
        name?: string;
        pricing?: { prompt?: string; completion?: string };
        supported_parameters?: string[];
      }[];
    };

    return (body.data ?? [])
      // Every agent depends on schema-constrained output, so a model without it
      // is not a valid choice here.
      .filter((m) => m.supported_parameters?.includes("structured_outputs"))
      .map((m) => {
        const out = Number(m.pricing?.completion ?? 0) * 1_000_000;
        const price = out === 0 ? "free" : `$${out.toFixed(2)}/M out`;
        return { id: m.id, label: `${m.name ?? m.id} — ${price}` };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  },
};
