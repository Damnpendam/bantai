import { Llm } from "@/lib/llm";
import type { Effort } from "@/lib/providers";
import type { ModelAccess } from "@/lib/settings";

/**
 * Builds an Llm from a workspace's resolved access. `effort` can be lowered per
 * call site — extraction and resolution are mechanical work that a reasoning
 * model should not be spending its budget on.
 */
export function makeLlm(
  access: ModelAccess,
  maxTokens: number,
  signal?: AbortSignal,
  effort?: Effort,
): Llm {
  return new Llm({
    provider: access.provider,
    model: access.model,
    effort: effort ?? access.effort,
    apiKey: access.apiKey,
    maxTokens,
    signal,
  });
}
