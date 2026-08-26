import { AGENTS } from "@/lib/agents/roster";
import type { AgentId, AgentState } from "@/lib/types";

export const ALL_AGENT_IDS: AgentId[] = [
  "planner",
  ...AGENTS.map((a) => a.id),
  "reviewer",
];

export function initialAgents(): AgentState[] {
  return ALL_AGENT_IDS.map((id) => ({ id, status: "queued", caseCount: 0 }));
}
