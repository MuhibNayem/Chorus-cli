import { randomUUID } from "crypto";
import { z } from "zod";
import type { ChatMessage } from "../llm/provider.js";
import type { AgentTool } from "../agent/types.js";
import type { HandoffRequest, SwarmConfig, SwarmSession } from "./types.js";

export function createSession(config: SwarmConfig): SwarmSession {
  const sessionId = randomUUID();
  const swarmId = `swarm-${Date.now()}-${sessionId.slice(0, 8)}`;
  const traceId = randomUUID();

  const MAX_TOKENS_PER_AGENT = 50_000;
  const perAgent: Record<string, number> = {};
  for (const agent of config.agents) {
    perAgent[agent.name] = MAX_TOKENS_PER_AGENT;
  }

  return {
    sessionId,
    swarmId,
    sharedMessages: [],
    agentMessages: {},
    lastHandoffDescription: {},
    activeAgent: null,
    artifacts: {},
    agentHistory: [],
    spec: config.spec ?? "",
    handoffCount: 0,
    maxHandoffs: config.maxHandoffs ?? 10,
    tokenBudget: { perAgent, total: MAX_TOKENS_PER_AGENT * config.agents.length },
    traceId,
  };
}

export function broadcastToSharedState(
  session: SwarmSession,
  messages: ChatMessage[],
  agentName: string,
): void {
  for (const msg of messages) {
    if (msg.role === "assistant" || msg.role === "tool") {
      session.sharedMessages.push({ ...msg });
    }
  }
  const agentMsgs = session.agentMessages[agentName];
  if (agentMsgs) {
    for (const msg of messages) {
      agentMsgs.push({ ...msg });
    }
  } else {
    session.agentMessages[agentName] = messages.map((m) => ({ ...m }));
  }
}

export function applyHandoff(session: SwarmSession, request: HandoffRequest): void {
  session.activeAgent = request.targetAgent;
  session.lastHandoffDescription[request.targetAgent] = request.taskDescription;
  session.handoffCount += 1;
  session.agentHistory.push(request.targetAgent);

  for (const key of request.artifacts) {
    if (session.artifacts[key] !== undefined) {
      // artifact already present — no-op, agent will read via get_artifact
    }
  }
}

export function createArtifactTools(session: Pick<SwarmSession, "artifacts">): AgentTool[] {
  const setArtifact: AgentTool = {
    name: "set_artifact",
    description: "Store a named artifact that persists across agent handoffs.",
    schema: z.object({
      key: z.string().describe("Artifact name (alphanumeric, hyphens, underscores)"),
      value: z.string().describe("Content to store"),
    }),
    async invoke(input) {
      const { key, value } = input as { key: string; value: string };
      const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
      session.artifacts[safeKey] = value;
      return `Artifact "${safeKey}" stored (${value.length} chars).`;
    },
  };

  const getArtifact: AgentTool = {
    name: "get_artifact",
    description: "Retrieve a named artifact set by any agent in this swarm.",
    schema: z.object({
      key: z.string().describe("Artifact name to retrieve"),
    }),
    async invoke(input) {
      const { key } = input as { key: string };
      const value = session.artifacts[key];
      if (value === undefined) {
        const keys = Object.keys(session.artifacts);
        return keys.length
          ? `Artifact "${key}" not found. Available: ${keys.join(", ")}`
          : `Artifact "${key}" not found. No artifacts stored yet.`;
      }
      return value;
    },
  };

  const listArtifacts: AgentTool = {
    name: "list_artifacts",
    description: "List all artifact keys available in this swarm session.",
    schema: z.object({}),
    async invoke() {
      const keys = Object.keys(session.artifacts);
      return keys.length ? keys.join("\n") : "No artifacts stored yet.";
    },
  };

  return [setArtifact, getArtifact, listArtifacts];
}
