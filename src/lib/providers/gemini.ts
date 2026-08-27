import { GoogleGenAI, ApiError, ThinkingLevel } from "@google/genai";
import { LlmError, type Effort, type JsonRequest, type ModelOption, type Provider } from "./types";

// Gemini exposes four thinking levels against our five-step effort scale.
const THINKING: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

/**
 * Google returns an error body whose "message" is itself a JSON document, so the
 * raw SDK message is a nest of escaped braces. Peel it down to the sentence.
 */
function unwrap(raw: string): string {
  let message = raw;
  for (let depth = 0; depth < 4; depth += 1) {
    const trimmed = message.trim();
    if (!trimmed.startsWith("{")) break;
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
      const inner = parsed.error?.message;
      if (!inner) break;
      message = inner;
    } catch {
      break;
    }
  }
  return message.trim();
}

function describe(error: unknown): LlmError {
  if (error instanceof ApiError) {
    const message = unwrap(error.message);
    if (error.status === 404) {
      // Google retires model ids faster than any hardcoded default survives.
      return new LlmError(
        `${message} Open settings and pick a model — the list is loaded live from your account.`,
        false,
      );
    }
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      return new LlmError(`Gemini rejected the request (${error.status}): ${message}`, false);
    }
    if (error.status === 429) {
      // Free-tier exhaustion and per-minute throttling share a status code, but
      // only one of them is worth retrying.
      if (/quota|billing|exhausted/i.test(message)) {
        return new LlmError(
          "Your Gemini quota is exhausted. Check your plan at aistudio.google.com, or switch provider in settings.",
          false,
        );
      }
      return new LlmError("Rate limited by the Gemini API.", true);
    }
    return new LlmError(`Gemini API error ${error.status}: ${message}`, error.status >= 500);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LlmError(message, /fetch failed|ECONN|network|timeout/i.test(message));
}

/**
 * thinkingLevel is not accepted by every Gemini model. Rather than maintain a
 * per-model capability table that will drift, ask for it and drop it if the
 * API says no.
 */
function isUnsupportedThinking(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    /thinking/i.test(unwrap(error.message))
  );
}

export const geminiProvider: Provider = {
  id: "gemini",
  label: "Google Gemini",
  keyUrl: "https://aistudio.google.com/apikey",
  keyPlaceholder: "AIza…",
  // Prefer Google's maintained aliases over pinned ids, which get retired for new
  // users without warning. Anything else comes from the live list once a key is set.
  defaultModel: "gemini-flash-latest",
  listNeedsKey: true,
  fallbackModels: [
    { id: "gemini-flash-latest", label: "Gemini Flash (latest)" },
    { id: "gemini-pro-latest", label: "Gemini Pro (latest)" },
    { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite (latest)" },
  ],

  async json(apiKey, model, request: JsonRequest): Promise<string> {
    const ai = new GoogleGenAI({ apiKey });

    const call = async (withThinking: boolean): Promise<string> => {
      const stream = await ai.models.generateContentStream({
        model,
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.maxTokens,
          responseMimeType: "application/json",
          responseJsonSchema: request.schema,
          ...(withThinking
            ? { thinkingConfig: { thinkingLevel: THINKING[request.effort] } }
            : {}),
          abortSignal: request.signal,
        },
      });

      let text = "";
      let finishReason: string | undefined;
      for await (const chunk of stream) {
        request.onActivity?.();
        const delta = chunk.text;
        if (delta) {
          text += delta;
          request.onToken?.(delta);
        }
        const reason = chunk.candidates?.[0]?.finishReason;
        if (reason) finishReason = String(reason);
      }

      if (finishReason === "MAX_TOKENS") {
        throw new LlmError(
          "The response hit the token ceiling before finishing. Lower the target case count for this agent.",
          false,
        );
      }
      if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
        throw new LlmError(
          `Gemini declined this request (${finishReason}).`,
          false,
        );
      }
      if (!text.trim()) {
        throw new LlmError("Gemini returned an empty response.", true);
      }
      return text;
    };

    try {
      return await call(true);
    } catch (error) {
      if (isUnsupportedThinking(error)) {
        return call(false).catch((retryError) => {
          throw retryError instanceof LlmError ? retryError : describe(retryError);
        });
      }
      throw error instanceof LlmError ? error : describe(error);
    }
  },

  async verifyKey(apiKey: string): Promise<boolean> {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const pager = await ai.models.list();
      // Touching the first page is what actually authenticates.
      for await (const _model of pager) break;
      return true;
    } catch {
      return false;
    }
  },

  async listModels(apiKey: string): Promise<ModelOption[]> {
    const ai = new GoogleGenAI({ apiKey });
    const pager = await ai.models.list();
    const options: ModelOption[] = [];
    for await (const model of pager) {
      const actions = model.supportedActions;
      if (actions && !actions.includes("generateContent")) continue;
      const id = (model.name ?? "").replace(/^models\//, "");
      if (!id) continue;
      options.push({ id, label: model.displayName ?? id });
      if (options.length >= 100) break;
    }
    return options;
  },
};
