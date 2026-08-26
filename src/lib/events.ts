import type { RunEvent } from "@/lib/types";

type Listener = (event: RunEvent) => void;

// Runs live in the server process; SSE clients attach and detach freely, and a
// reconnecting client replays the backlog so it never misses a wave.
interface Channel {
  listeners: Set<Listener>;
  backlog: RunEvent[];
}

const g = globalThis as unknown as { __bantaiChannels?: Map<string, Channel> };
const channels: Map<string, Channel> = (g.__bantaiChannels ??= new Map());

function channel(runId: string): Channel {
  let c = channels.get(runId);
  if (!c) {
    c = { listeners: new Set(), backlog: [] };
    channels.set(runId, c);
  }
  return c;
}

export function emit(runId: string, event: RunEvent): void {
  const c = channel(runId);
  c.backlog.push(event);
  if (c.backlog.length > 500) c.backlog.splice(0, c.backlog.length - 500);
  for (const listener of c.listeners) {
    try {
      listener(event);
    } catch {
      // A dead client must never take down a run.
    }
  }
}

export function subscribe(runId: string, listener: Listener): () => void {
  const c = channel(runId);
  for (const event of c.backlog) listener(event);
  c.listeners.add(listener);
  return () => {
    c.listeners.delete(listener);
  };
}

export function closeChannel(runId: string): void {
  channels.delete(runId);
}
