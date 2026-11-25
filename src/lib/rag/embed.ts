import { LlmError, PROVIDER_LIST, getProvider, type ProviderId } from "@/lib/providers";
import { getApiKey, getConfig, platformConfig } from "@/lib/settings";
import type { Embedder } from "@/lib/rag/indexer";

export interface EmbedAccess {
  provider: ProviderId;
  /** The provider's embedding model id, as sent on the wire. */
  model: string;
  /** What is stored beside each vector, so a change of model re-embeds. */
  modelKey: string;
  apiKey: string;
  source: "workspace" | "platform";
  label: string;
}

function access(
  provider: ProviderId,
  apiKey: string,
  source: "workspace" | "platform",
): EmbedAccess | null {
  const p = getProvider(provider);
  if (!p.embed || !p.embedModel) return null;
  return {
    provider,
    model: p.embedModel,
    modelKey: `${provider}:${p.embedModel}`,
    apiKey,
    source,
    label: p.label,
  };
}

/**
 * Which key can produce embeddings. The workspace's chosen provider goes first,
 * but a workspace that chats with Anthropic (which has no embeddings API) can
 * still get semantic search from any other key it has saved. Null means
 * keyword search only.
 */
export function resolveEmbedAccess(workspaceId: string): EmbedAccess | null {
  const chosen = getConfig(workspaceId).provider;
  const order = [chosen, ...PROVIDER_LIST.map((p) => p.id).filter((id) => id !== chosen)];
  for (const id of order) {
    const key = getApiKey(workspaceId, id);
    const found = key ? access(id, key, "workspace") : null;
    if (found) return found;
  }
  const platform = platformConfig();
  return platform ? access(platform.provider, platform.apiKey, "platform") : null;
}

const RETRY_MS = [2_000, 8_000];

function pause(ms: number, signal?: AbortSignal): Promise<void> {
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

export function makeEmbedder(target: EmbedAccess, signal?: AbortSignal): Embedder {
  const provider = getProvider(target.provider);
  return async (texts, kind) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await provider.embed!(target.apiKey, target.model, texts, kind, signal);
      } catch (error) {
        const retryable = error instanceof LlmError && error.retryable;
        if (!retryable || attempt >= RETRY_MS.length) throw error;
        await pause((error as LlmError).retryAfterMs ?? RETRY_MS[attempt], signal);
      }
    }
  };
}
