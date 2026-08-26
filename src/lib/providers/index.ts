import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { openrouterProvider } from "./openrouter";
import type { Provider, ProviderId } from "./types";

export * from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  openrouter: openrouterProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
};

export const PROVIDER_LIST: Provider[] = [
  openrouterProvider,
  anthropicProvider,
  geminiProvider,
];

export const DEFAULT_PROVIDER: ProviderId = "openrouter";

export function getProvider(id: string): Provider {
  const provider = PROVIDERS[id as ProviderId];
  if (!provider) {
    throw new Error(`Unknown provider "${id}".`);
  }
  return provider;
}

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}
