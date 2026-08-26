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
}

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

  return { provider, model, effort };
}

export function setConfig(patch: Partial<AppConfig>): void {
  if (patch.provider) setSetting("provider", patch.provider);
  if (patch.effort) setSetting("effort", patch.effort);
  if (patch.model) {
    const provider = patch.provider ?? getConfig().provider;
    setSetting(`model:${provider}`, patch.model);
  }
}
