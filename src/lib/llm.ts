import { getProvider, LlmError, type Effort, type ProviderId } from "@/lib/providers";
import { parseModelJson } from "@/lib/json-salvage";

export { LlmError };
export type { Effort, ProviderId };

/**
 * How long a call may produce nothing before we give up on it. Measured between
 * tokens rather than as a total, so a legitimately long suite is never cut off
 * while it is still streaming.
 */
const STALL_MS = 300_000;

/** Retrying a rate limit immediately just burns the second attempt. */
const BACKOFF_MS = [5_000, 20_000];
const MAX_BACKOFF_MS = 60_000;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new LlmError("Cancelled.", false));
      },
      { once: true },
    );
  });
}

export interface LlmOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Aborts every call made through this instance, e.g. when a run is cancelled. */
  signal?: AbortSignal;
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
      if (this.options.signal) signals.push(this.options.signal);

      let text: string;
      try {
        text = await provider.json(this.options.apiKey, this.options.model, {
          system: args.system,
          prompt: args.prompt,
          schema: args.schema,
          maxTokens: this.options.maxTokens,
          effort: this.options.effort,
          signal: AbortSignal.any(signals),
          // Liveness comes from any stream event, not just visible output.
          onActivity: () => {
            lastActivity = Date.now();
          },
          onToken: (delta) => {
            lastActivity = Date.now();
            args.onToken?.(delta);
          },
        });
      } catch (error) {
        if (this.options.signal?.aborted || args.signal?.aborted) {
          throw new LlmError("Cancelled.", false);
        }
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

    let lastError: LlmError | undefined;
    for (let tries = 0; tries <= BACKOFF_MS.length; tries += 1) {
      try {
        return await attempt();
      } catch (error) {
        lastError =
          error instanceof LlmError
            ? error
            : new LlmError(error instanceof Error ? error.message : String(error), false);
        if (!lastError.retryable || tries === BACKOFF_MS.length) throw lastError;
        const delay = Math.min(
          lastError.retryAfterMs ?? BACKOFF_MS[tries],
          MAX_BACKOFF_MS,
        );
        await wait(delay, args.signal);
      }
    }
    throw lastError ?? new LlmError("The call failed for an unknown reason.", false);
  }
}
