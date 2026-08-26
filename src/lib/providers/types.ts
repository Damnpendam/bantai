export type ProviderId = "openrouter" | "anthropic" | "gemini";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export class LlmError extends Error {
  readonly retryable: boolean;
  /** Honoured before retrying. Providers set it from a Retry-After header. */
  readonly retryAfterMs?: number;
  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = "LlmError";
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Seconds or an HTTP date, per RFC 9110. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  // A numeric value is a seconds count; if it is nonsense, do not fall through to
  // date parsing, which happily reads "-5" as a year and yields "retry now".
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? seconds * 1000 : undefined;
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: Effort;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}

export interface ModelOption {
  id: string;
  label: string;
}

/**
 * A provider turns a schema-constrained request into raw JSON text. Parsing,
 * validation and retry live one level up in Llm, so every provider behaves the
 * same way when a model returns something malformed.
 */
export interface Provider {
  id: ProviderId;
  label: string;
  /** Where the user gets a key, shown in settings. */
  keyUrl: string;
  keyPlaceholder: string;
  defaultModel: string;
  /** Used when the live model list cannot be fetched. */
  fallbackModels: ModelOption[];
  /** False when the catalogue is public and can be listed before a key is saved. */
  listNeedsKey: boolean;
  json(apiKey: string, model: string, request: JsonRequest): Promise<string>;
  verifyKey(apiKey: string): Promise<boolean>;
  listModels(apiKey: string): Promise<ModelOption[]>;
}
