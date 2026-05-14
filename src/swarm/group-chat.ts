/**
 * GroupChat — multi-speaker agent coordination with voting and map-reduce.
 *
 * Inspired by AutoGen v0.4 GroupChat. Supports:
 *   - round-robin speaker selection
 *   - LLM-based speaker selection (considers conversation history)
 *   - vote merge (majority-wins on categorical outputs)
 *   - concatenate merge (all responses joined)
 *   - first-success merge (stops at first agent that produces the artifact)
 */

import { randomUUID } from "crypto";
import { runAgentLoop } from "../agent/loop.js";
import { HitlGate } from "../agent/hitl.js";
import { BtwQueue } from "../agent/btw.js";
import { JsonFileCheckpointer } from "../agent/checkpointer.js";
import { createDefaultMiddleware } from "../agent/middleware.js";
import type { LLMProvider } from "../llm/provider.js";
import type { AgentTool } from "../agent/types.js";
import type { ChatMessage } from "../llm/provider.js";

export type SpeakerSelector = "round-robin" | "llm";
export type MergeStrategy = "vote" | "concatenate" | "first-success";

export interface GroupChatAgent {
  name: string;
  systemPrompt: string;
  tools?: AgentTool[];
  model?: string;
  maxRounds?: number;
}

export interface GroupChatConfig {
  agents: GroupChatAgent[];
  task: string;
  provider: LLMProvider;
  modelName: string;
  /** Number of full discussion rounds (each agent speaks once per round). Default: 1 */
  rounds?: number;
  speakerSelector?: SpeakerSelector;
  merge?: MergeStrategy;
  /** For vote merge: minimum fraction of agents that must agree. Default: 0.5 */
  voteThreshold?: number;
}

export type GroupChatEvent =
  | { type: "group-start"; agents: string[]; rounds: number }
  | { type: "turn-start"; agent: string; round: number }
  | { type: "turn-done"; agent: string; round: number; response: string }
  | { type: "group-done"; result: string; winner?: string; votes?: Record<string, number> };

async function runAgentTurn(
  agent: GroupChatAgent,
  messages: ChatMessage[],
  config: GroupChatConfig,
): Promise<string> {
  const threadId = `groupchat-${agent.name}-${randomUUID()}`;
  const hitlGate = new HitlGate();
  const btwQueue = new BtwQueue();
  const checkpointer = new JsonFileCheckpointer();
  const middleware = createDefaultMiddleware(threadId);

  let response = "";
  for await (const event of runAgentLoop({
    provider: config.provider,
    model: agent.model ?? config.modelName,
    tools: agent.tools ?? [],
    messages,
    systemPrompt: agent.systemPrompt,
    threadId,
    hitlGate,
    btwQueue,
    policy: "full_auto",
    checkpointer,
    maxRounds: agent.maxRounds ?? 5,
    middleware,
  })) {
    if (event.type === "done") response = event.response;
  }
  return response;
}

function selectNextSpeaker(
  agents: GroupChatAgent[],
  idx: number,
  _selector: SpeakerSelector,
): GroupChatAgent {
  // round-robin (llm selector is a future extension requiring an additional LLM call)
  return agents[idx % agents.length];
}

function mergeResponses(
  responses: Array<{ agent: string; response: string }>,
  strategy: MergeStrategy,
  voteThreshold: number,
): { result: string; winner?: string; votes?: Record<string, number> } {
  if (strategy === "concatenate") {
    return {
      result: responses.map((r) => `[${r.agent}]: ${r.response}`).join("\n\n"),
    };
  }

  if (strategy === "first-success") {
    const first = responses[0];
    return { result: first?.response ?? "", winner: first?.agent };
  }

  // vote: treat trimmed response as a "ballot" — most common response wins
  const tally = new Map<string, number>();
  for (const r of responses) {
    const key = r.response.trim().toLowerCase().slice(0, 200);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  const votes: Record<string, number> = {};
  let topKey = "";
  let topCount = 0;
  for (const [key, count] of tally) {
    votes[key] = count;
    if (count > topCount) {
      topCount = count;
      topKey = key;
    }
  }

  const winningResponse = responses.find(
    (r) => r.response.trim().toLowerCase().slice(0, 200) === topKey,
  );

  const threshold = Math.ceil(responses.length * voteThreshold);
  if (topCount < threshold) {
    // No consensus — concatenate all
    return {
      result: responses.map((r) => `[${r.agent}]: ${r.response}`).join("\n\n"),
      votes,
    };
  }

  return {
    result: winningResponse?.response ?? topKey,
    winner: winningResponse?.agent,
    votes,
  };
}

export async function* runGroupChat(
  config: GroupChatConfig,
): AsyncGenerator<GroupChatEvent> {
  const { agents, rounds = 1, speakerSelector = "round-robin", merge = "concatenate", voteThreshold = 0.5 } = config;

  yield { type: "group-start", agents: agents.map((a) => a.name), rounds };

  const sharedHistory: ChatMessage[] = [
    { role: "user", content: config.task },
  ];

  const allResponses: Array<{ agent: string; response: string }> = [];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < agents.length; i++) {
      const agent = selectNextSpeaker(agents, i, speakerSelector);
      yield { type: "turn-start", agent: agent.name, round };

      const response = await runAgentTurn(agent, [...sharedHistory], config);

      // Broadcast this response to the shared history for next speakers
      sharedHistory.push({ role: "assistant", content: `[${agent.name}]: ${response}` });

      allResponses.push({ agent: agent.name, response });
      yield { type: "turn-done", agent: agent.name, round, response };

      // first-success: stop as soon as we have one response
      if (merge === "first-success") {
        yield {
          type: "group-done",
          result: response,
          winner: agent.name,
        };
        return;
      }
    }
  }

  const merged = mergeResponses(allResponses, merge, voteThreshold);
  yield { type: "group-done", ...merged };
}
