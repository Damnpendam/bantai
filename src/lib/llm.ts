import { getProvider, LlmError, type Effort, type ProviderId } from "@/lib/providers";
import { parseModelJson } from "@/lib/json-salvage";

export { LlmError };
export type { Effort, ProviderId };

/**
 * How long a call may produce nothing before we give up on it. Measured between
 * tokens rather than as a total, so a legitimately long suite is never cut off
 * while it is still streaming.
 */
const STALL_MS = 180_000;

export interface LlmOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  effort: Effort;
  maxTokens: number;
}

export interface JsonCallArgs<T> {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
  /** Called when a truncated response was recovered rather than discarded. */
  onSalvage?: () => void;
  validate?: (value: unknown) => T;
}

/**
 * Provider-agnostic structured call. Every provider returns raw JSON text; the
 * parse, the malformed-output retry and the transient-failure retry live here so
 * all providers fail the same way.
 */
export class Llm {
  constructor(private readonly options: LlmOptions) {}

  async json<T>(args: JsonCallArgs<T>): Promise<T> {
    const provider = getProvider(this.options.provider);

    const attempt = async (): Promise<T> => {
      const watchdog = new AbortController();
      let lastActivity = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - lastActivity > STALL_MS) {
          watchdog.abort(new Error("stalled"));
        }
      }, 5_000);

      const signals = [watchdog.signal];
      if (args.signal) signals.push(args.signal);

      let text: string;
      try {
        text = await provider.json(this.options.apiKey, this.options.model, {
          system: args.system,
          prompt: args.prompt,
          schema: args.schema,
          maxTokens: this.options.maxTokens,
          effort: this.options.effort,
          signal: AbortSignal.any(signals),
          // Always observe the stream, even when the caller wants no tokens —
          // this is what tells the watchdog the call is still alive.
          onToken: (delta) => {
            lastActivity = Date.now();
            args.onToken?.(delta);
          },
        });
      } catch (error) {
        if (watchdog.signal.aborted) {
          throw new LlmError(
            `${provider.label} stopped sending data for ${STALL_MS / 1000}s and the call was abandoned. The model may be overloaded — try another in settings.`,
            true,
          );
        }
        throw error;
      } finally {
        clearInterval(timer);
      }

      const parsed = parseModelJson(text);
      if (!parsed) {
        // Quote what actually came back — without it this is undebuggable.
        const preview = text.trim().slice(0, 180).replace(/\s+/g, " ");
        throw new LlmError(
          `${provider.label} returned output that was not valid JSON. The model may not support schema-constrained output — try another in settings. It began: ${preview || "(empty)"}`,
          true,
        );
      }
      if (parsed.salvaged) args.onSalvage?.();
      return args.validate ? args.validate(parsed.value) : (parsed.value as T);
    };

    try {
      return await attempt();
    } catch (error) {
      const wrapped =
        error instanceof LlmError
          ? error
          : new LlmError(error instanceof Error ? error.message : String(error), false);
      if (!wrapped.retryable) throw wrapped;
      return attempt();
    }
  }
}
