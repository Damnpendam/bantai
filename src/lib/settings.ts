import { getSetting, setSetting, deleteSetting } from "@/lib/store";
import {
  DEFAULT_PROVIDER,
  EFFORTS,
  getProvider,
  isProviderId,
  type Effort,
  type ProviderId,
} from "@/lib/providers";

export interface AppConfig {
  provider: ProviderId;
  model: string;
  effort: Effort;
  /** How many writer agents may run at once. Free tiers reject bursts of four. */
  concurrency: number;
}

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 4;
export const DEFAULT_CONCURRENCY = 2;

function keyName(provider: ProviderId): string {
  return `apiKey:${provider}`;
}

/**
 * Before multi-provider support the key and model lived under bare "apiKey" and
 * "model" keys and were always Anthropic's. Move them once so existing installs
 * keep their configuration instead of silently reverting to defaults.
 */
function migrateLegacy(): void {
  const legacyKey = getSetting("apiKey");
  if (legacyKey) {
    if (!getSetting(keyName("anthropic"))) {
      setSetting(keyName("anthropic"), legacyKey);
    }
    deleteSetting("apiKey");
  }
  const legacyModel = getSetting("model");
  if (legacyModel) {
    if (!getSetting("model:anthropic")) {
      setSetting("model:anthropic", legacyModel);
    }
    deleteSetting("model");
  }
}

export function getApiKey(provider: ProviderId): string | null {
  migrateLegacy();
  return getSetting(keyName(provider));
}

export function setApiKey(provider: ProviderId, apiKey: string): void {
  setSetting(keyName(provider), apiKey);
}

export function clearApiKey(provider: ProviderId): void {
  deleteSetting(keyName(provider));
}

export function getConfig(): AppConfig {
  migrateLegacy();
  const stored = getSetting("provider");
  const provider: ProviderId =
    stored && isProviderId(stored) ? stored : DEFAULT_PROVIDER;

  const storedEffort = getSetting("effort") as Effort | null;
  const effort: Effort =
    storedEffort && EFFORTS.includes(storedEffort) ? storedEffort : "high";

  // Models are per-provider: a Claude id is meaningless once you switch to Gemini.
  const model = getSetting(`model:${provider}`) ?? getProvider(provider).defaultModel;

  // Number(null) is 0, which would clamp to 1 and quietly replace the default.
  const storedConcurrency = getSetting("concurrency");
  const parsed = storedConcurrency === null ? NaN : Number(storedConcurrency);
  const concurrency = Number.isFinite(parsed)
    ? Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.trunc(parsed)))
    : DEFAULT_CONCURRENCY;

  return { provider, model, effort, concurrency };
}

export function setConfig(patch: Partial<AppConfig>): void {
  if (patch.provider) setSetting("provider", patch.provider);
  if (patch.effort) setSetting("effort", patch.effort);
  if (patch.concurrency !== undefined) {
    const n = Math.min(
      MAX_CONCURRENCY,
      Math.max(MIN_CONCURRENCY, Math.trunc(patch.concurrency)),
    );
    setSetting("concurrency", String(n));
  }
  if (patch.model) {
    const provider = patch.provider ?? getConfig().provider;
    setSetting(`model:${provider}`, patch.model);
  }
}
