import { Llm } from "@/lib/llm";
import { getApiKey, getConfig } from "@/lib/settings";
import { getProvider, type Effort } from "@/lib/providers";

/**
 * Builds an Llm from the saved provider/model/effort settings. `effort` can be
 * overridden per call site — extraction and resolution are mechanical work that
 * a reasoning model should not be spending its budget on, so they ask for a
 * lower effort than a run's default.
 */
export function makeLlm(
  maxTokens: number,
  signal?: AbortSignal,
  effort?: Effort,
): Llm {
  const config = getConfig();
  const apiKey = getApiKey(config.provider);
  if (!apiKey) {
    throw new Error(
      `No ${getProvider(config.provider).label} API key configured. Add one in settings.`,
    );
  }
  return new Llm({ ...config, effort: effort ?? config.effort, apiKey, maxTokens, signal });
}
