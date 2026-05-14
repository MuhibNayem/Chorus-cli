import { countMessagesTokens } from "../context/tokenizer.js";
import type { SwarmAgent, SwarmSession, CircuitBreakerResult } from "./types.js";

const MAX_CONSECUTIVE_SAME_AGENT = 3;
const MAX_TOKENS_PER_AGENT = 50_000;

export function checkCircuitBreaker(
  session: SwarmSession,
  agent: SwarmAgent,
): CircuitBreakerResult {
  // 1. handoff budget exhausted
  if (session.handoffCount >= session.maxHandoffs) {
    return {
      tripped: true,
      reason: `Max handoffs reached (${session.maxHandoffs}). Halting swarm.`,
    };
  }

  // 2. same agent in a tight loop
  const recent = session.agentHistory.slice(-MAX_CONSECUTIVE_SAME_AGENT);
  if (
    recent.length === MAX_CONSECUTIVE_SAME_AGENT &&
    recent.every((name) => name === agent.name)
  ) {
    return {
      tripped: true,
      reason: `Agent "${agent.name}" was selected ${MAX_CONSECUTIVE_SAME_AGENT} consecutive times — possible infinite loop.`,
    };
  }

  // 3. per-agent token budget
  const agentMsgs = session.agentMessages[agent.name] ?? [];
  if (agentMsgs.length > 0) {
    const used = countMessagesTokens(agentMsgs, "");
    const budget = session.tokenBudget.perAgent[agent.name] ?? MAX_TOKENS_PER_AGENT;
    if (used >= budget) {
      return {
        tripped: true,
        reason: `Agent "${agent.name}" exceeded its token budget (${used} / ${budget} tokens).`,
      };
    }
  }

  return { tripped: false };
}
