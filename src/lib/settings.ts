import {
  countUsageSince,
  deleteWorkspaceSetting,
  getWorkspaceSetting,
  recordUsageEvent,
  setWorkspaceSetting,
} from "@/lib/store";
import { decrypt, encrypt, isEncrypted } from "@/lib/secrets";
import {
  DEFAULT_PROVIDER,
  EFFORTS,
  getProvider,
  isProviderId,
  type Effort,
  type ProviderId,
} from "@/lib/providers";

/**
 * Provider settings are per workspace: each tenant brings its own keys, stored
 * encrypted. Optionally the operator supplies a shared platform key through the
 * environment, used by any workspace that hasn't added one of its own — on the
 * operator's chosen model, and capped per workspace per day, because it's the
 * operator paying.
 */

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

const DAY_MS = 24 * 60 * 60 * 1000;

function clampConcurrency(value: number): number {
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.trunc(value)));
}

export function getConfig(workspaceId: string): AppConfig {
  const stored = getWorkspaceSetting(workspaceId, "provider");
  const provider: ProviderId = stored && isProviderId(stored) ? stored : DEFAULT_PROVIDER;

  const storedEffort = getWorkspaceSetting(workspaceId, "effort") as Effort | null;
  const effort: Effort =
    storedEffort && EFFORTS.includes(storedEffort) ? storedEffort : "medium";

  // Models are per-provider: a Claude id is meaningless once you switch to Gemini.
  const model =
    getWorkspaceSetting(workspaceId, `model:${provider}`) ?? getProvider(provider).defaultModel;

  // Number(null) is 0, which would clamp to 1 and quietly replace the default.
  const storedConcurrency = getWorkspaceSetting(workspaceId, "concurrency");
  const parsed = storedConcurrency === null ? NaN : Number(storedConcurrency);
  const concurrency = Number.isFinite(parsed) ? clampConcurrency(parsed) : DEFAULT_CONCURRENCY;

  return { provider, model, effort, concurrency };
}

export function setConfig(workspaceId: string, patch: Partial<AppConfig>): void {
  if (patch.provider) setWorkspaceSetting(workspaceId, "provider", patch.provider);
  if (patch.effort) setWorkspaceSetting(workspaceId, "effort", patch.effort);
  if (patch.concurrency !== undefined) {
    setWorkspaceSetting(workspaceId, "concurrency", String(clampConcurrency(patch.concurrency)));
  }
  if (patch.model) {
    const provider = patch.provider ?? getConfig(workspaceId).provider;
    setWorkspaceSetting(workspaceId, `model:${provider}`, patch.model);
  }
}

export function getApiKey(workspaceId: string, provider: ProviderId): string | null {
  const stored = getWorkspaceSetting(workspaceId, `apiKey:${provider}`);
  if (!stored) return null;
  if (!isEncrypted(stored)) {
    // Written before encryption existed: seal it now, in place.
    setWorkspaceSetting(workspaceId, `apiKey:${provider}`, encrypt(stored));
    return stored;
  }
  try {
    return decrypt(stored);
  } catch {
    console.error(
      `[settings] could not decrypt the ${provider} key for workspace ${workspaceId} — was APP_SECRET changed? Re-enter the key in Settings.`,
    );
    return null;
  }
}

export function setApiKey(workspaceId: string, provider: ProviderId, apiKey: string): void {
  setWorkspaceSetting(workspaceId, `apiKey:${provider}`, encrypt(apiKey));
}

export function clearApiKey(workspaceId: string, provider: ProviderId): void {
  deleteWorkspaceSetting(workspaceId, `apiKey:${provider}`);
}

// ---------------------------------------------------------------------------
// The shared platform key
// ---------------------------------------------------------------------------

export interface PlatformConfig {
  provider: ProviderId;
  model: string;
  effort: Effort;
  apiKey: string;
  concurrency: number;
  dailyRuns: number;
  dailyIngests: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

export function platformConfig(): PlatformConfig | null {
  const apiKey = process.env.PLATFORM_API_KEY?.trim();
  if (!apiKey) return null;
  const requested = process.env.PLATFORM_PROVIDER ?? DEFAULT_PROVIDER;
  const provider: ProviderId = isProviderId(requested) ? requested : DEFAULT_PROVIDER;
  const effortEnv = process.env.PLATFORM_EFFORT as Effort | undefined;
  return {
    provider,
    model: process.env.PLATFORM_MODEL?.trim() || getProvider(provider).defaultModel,
    effort: effortEnv && EFFORTS.includes(effortEnv) ? effortEnv : "low",
    apiKey,
    concurrency: clampConcurrency(positiveInt(process.env.PLATFORM_CONCURRENCY, 2) || 2),
    dailyRuns: positiveInt(process.env.PLATFORM_DAILY_RUNS, 3),
    dailyIngests: positiveInt(process.env.PLATFORM_DAILY_INGESTS, 10),
  };
}

/** Everything a model call needs, and whose money it spends. */
export interface ModelAccess {
  provider: ProviderId;
  model: string;
  effort: Effort;
  concurrency: number;
  apiKey: string;
  source: "workspace" | "platform";
}

export function resolveModelAccess(workspaceId: string): ModelAccess | null {
  const config = getConfig(workspaceId);
  const own = getApiKey(workspaceId, config.provider);
  if (own) return { ...config, apiKey: own, source: "workspace" };
  const platform = platformConfig();
  if (platform) {
    return {
      provider: platform.provider,
      model: platform.model,
      effort: platform.effort,
      concurrency: platform.concurrency,
      apiKey: platform.apiKey,
      source: "platform",
    };
  }
  return null;
}

export function noAccessMessage(workspaceId: string): string {
  const { provider } = getConfig(workspaceId);
  return `Add an API key for ${getProvider(provider).label} in Settings before running.`;
}

export type UsageKind = "run" | "ingest";

export function usageToday(workspaceId: string, kind: UsageKind): number {
  return countUsageSince(workspaceId, kind, Date.now() - DAY_MS, true);
}

/** Why this workspace can't spend the platform key right now, or null. */
export function quotaProblem(
  workspaceId: string,
  access: ModelAccess,
  kind: UsageKind,
): string | null {
  if (access.source !== "platform") return null;
  const platform = platformConfig();
  if (!platform) return null;
  const limit = kind === "run" ? platform.dailyRuns : platform.dailyIngests;
  if (usageToday(workspaceId, kind) < limit) return null;
  const what = kind === "run" ? "test-case runs" : "model builds";
  return `This workspace has used its ${limit} free ${what} for today on the shared key. Add your own API key in Settings to keep going, or try again tomorrow.`;
}

export function recordUsage(
  workspaceId: string,
  userId: string,
  kind: UsageKind,
  access: ModelAccess,
): void {
  recordUsageEvent(workspaceId, userId, kind, access.source === "platform");
}
