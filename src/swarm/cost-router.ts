/**
 * Declarative cost routing — automatically selects a cheaper model
 * when swarm budget pressure is high or a task is flagged as simple.
 */

import type { CostBudget, CostRoutingPolicy } from "./types.js";

export interface RoutingContext {
  agentName: string;
  defaultModel: string;
  spentUsd: number;
  budgetTotalUsd?: number;
  taskDescription?: string;
  maxRounds?: number;
}

/**
 * Resolve the effective model for an agent, taking cost routing into account.
 * Returns the cheap model when budget pressure is high or task is simple.
 */
export function resolveModel(
  ctx: RoutingContext,
  policy?: CostRoutingPolicy,
): string {
  if (!policy || !policy.cheapModel) return ctx.defaultModel;

  // Already using the cheap model
  if (ctx.defaultModel === policy.cheapModel) return ctx.defaultModel;

  const threshold = policy.budgetPressureThreshold ?? 0.8;
  if (ctx.budgetTotalUsd && ctx.budgetTotalUsd > 0) {
    const fractionSpent = ctx.spentUsd / ctx.budgetTotalUsd;
    if (fractionSpent >= threshold) return policy.cheapModel;
  }

  // Single-round agents are "simple" by definition
  if (policy.simpleTaskMaxTokens && ctx.maxRounds === 1) {
    return policy.cheapModel;
  }

  return ctx.defaultModel;
}

/**
 * Check whether a cost budget has been exceeded. Returns a description
 * of the violation or null if under budget.
 */
export function checkCostBudget(
  agentName: string,
  agentCostUsd: number,
  totalCostUsd: number,
  budget?: CostBudget,
): { scope: "total" | "per-agent"; limitUsd: number; spentUsd: number } | null {
  if (!budget) return null;

  // Per-agent cap
  const agentLimit = budget.perAgentUsd?.[agentName];
  if (agentLimit !== undefined && agentCostUsd > agentLimit) {
    return { scope: "per-agent", limitUsd: agentLimit, spentUsd: agentCostUsd };
  }

  // Total cap
  if (budget.totalUsd !== undefined && totalCostUsd > budget.totalUsd) {
    return { scope: "total", limitUsd: budget.totalUsd, spentUsd: totalCostUsd };
  }

  return null;
}
