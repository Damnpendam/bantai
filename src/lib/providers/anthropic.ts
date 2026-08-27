import Anthropic from "@anthropic-ai/sdk";
import {
  LlmError,
  parseRetryAfter,
  type JsonRequest,
  type ModelOption,
  type Provider,
} from "./types";

/** The SDK stringifies the whole JSON body into .message; pull out the human part. */
function apiMessage(error: { error?: unknown; message: string }): string {
  const body = error.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? error.message;
}

function describe(error: unknown): LlmError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmError("The Anthropic API key was rejected. Check it in settings.", false);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError(
      "Rate limited by the Anthropic API.",
      true,
      parseRetryAfter(error.headers?.get?.("retry-after")),
    );
  }
  if (error instanceof Anthropic.BadRequestError) {
    const message = apiMessage(error);
    // Billing failures arrive as a 400, which reads like a bug in the request.
    if (/credit balance|purchase credits|billing/i.test(message)) {
      return new LlmError(
        "Your Anthropic credit balance is too low. Add credits at console.anthropic.com/settings/billing, or switch to another provider in settings.",
        false,
      );
    }
    return new LlmError(`Anthropic rejected the request: ${message}`, false);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError("Could not reach the Anthropic API.", true);
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmError(
      `Anthropic API error ${error.status ?? "?"}: ${apiMessage(error)}`,
      (error.status ?? 0) >= 500,
    );
  }
  return new LlmError(error instanceof Error ? error.message : String(error), false);
}

export const anthropicProvider: Provider = {
  id: "anthropic",
  label: "Anthropic",
  keyUrl: "https://console.anthropic.com/settings/keys",
  keyPlaceholder: "sk-ant-…",
  defaultModel: "claude-opus-5",
  listNeedsKey: true,
  fallbackModels: [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],

  async json(apiKey, model, request: JsonRequest): Promise<string> {
    const client = new Anthropic({ apiKey, maxRetries: 3 });
    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: request.maxTokens,
          system: request.system,
          thinking: { type: "adaptive" },
          output_config: {
            effort: request.effort,
            format: { type: "json_schema", schema: request.schema },
          },
          messages: [{ role: "user", content: request.prompt }],
        },
        { signal: request.signal },
      );

      if (request.onToken) {
        stream.on("text", (delta) => request.onToken!(delta));
      }
      // Thinking blocks and every other event count as liveness.
      if (request.onActivity) {
        stream.on("streamEvent", () => request.onActivity!());
      }

      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new LlmError(
          `The model declined this request (${message.stop_details?.category ?? "unspecified"}).`,
          false,
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new LlmError(
          "The response hit the token ceiling before finishing. Lower the target case count for this agent.",
          false,
        );
      }

      return message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    } catch (error) {
      throw error instanceof LlmError ? error : describe(error);
    }
  },

  async verifyKey(apiKey: string): Promise<boolean> {
    try {
      await new Anthropic({ apiKey, maxRetries: 0 }).models.list({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  },

  async listModels(apiKey: string): Promise<ModelOption[]> {
    const page = await new Anthropic({ apiKey, maxRetries: 1 }).models.list({ limit: 100 });
    return page.data.map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
  },
};
