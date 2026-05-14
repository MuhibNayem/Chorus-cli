import { describe, it, expect } from "vitest";
import { checkCostBudget, resolveModel } from "../src/swarm/cost-router.js";

describe("checkCostBudget", () => {
  it("returns null when no budget is configured", () => {
    expect(checkCostBudget("agent", 0.5, 1.0, undefined)).toBeNull();
  });

  it("returns null when under total budget", () => {
    expect(checkCostBudget("agent", 0.05, 0.09, { totalUsd: 0.10 })).toBeNull();
  });

  it("returns total violation when swarm total exceeds limit", () => {
    const result = checkCostBudget("agent", 0.05, 0.11, { totalUsd: 0.10 });
    expect(result).not.toBeNull();
    expect(result!.scope).toBe("total");
    expect(result!.limitUsd).toBe(0.10);
    expect(result!.spentUsd).toBe(0.11);
  });

  it("returns per-agent violation when agent exceeds its limit", () => {
    const result = checkCostBudget("expensive-agent", 0.06, 0.06, {
      perAgentUsd: { "expensive-agent": 0.05 },
    });
    expect(result).not.toBeNull();
    expect(result!.scope).toBe("per-agent");
    expect(result!.limitUsd).toBe(0.05);
  });

  it("per-agent cap is checked even when total is fine", () => {
    const result = checkCostBudget("agent-a", 0.06, 0.06, {
      totalUsd: 1.00,
      perAgentUsd: { "agent-a": 0.05 },
    });
    expect(result?.scope).toBe("per-agent");
  });

  it("returns null when agent is not in perAgentUsd map", () => {
    expect(
      checkCostBudget("agent-b", 0.99, 0.99, { perAgentUsd: { "agent-a": 0.05 } }),
    ).toBeNull();
  });
});

describe("resolveModel", () => {
  it("returns default model when no policy", () => {
    const m = resolveModel({ agentName: "a", defaultModel: "big-model", spentUsd: 0 });
    expect(m).toBe("big-model");
  });

  it("returns default model when no cheapModel in policy", () => {
    const m = resolveModel(
      { agentName: "a", defaultModel: "big-model", spentUsd: 0 },
      { budgetPressureThreshold: 0.8 },
    );
    expect(m).toBe("big-model");
  });

  it("returns cheap model when budget pressure exceeds threshold", () => {
    const m = resolveModel(
      { agentName: "a", defaultModel: "big-model", spentUsd: 0.9, budgetTotalUsd: 1.0 },
      { cheapModel: "cheap-model", budgetPressureThreshold: 0.8 },
    );
    expect(m).toBe("cheap-model");
  });

  it("returns default model when under pressure threshold", () => {
    const m = resolveModel(
      { agentName: "a", defaultModel: "big-model", spentUsd: 0.5, budgetTotalUsd: 1.0 },
      { cheapModel: "cheap-model", budgetPressureThreshold: 0.8 },
    );
    expect(m).toBe("big-model");
  });

  it("returns cheap model for single-round agents", () => {
    const m = resolveModel(
      { agentName: "a", defaultModel: "big-model", spentUsd: 0, maxRounds: 1 },
      { cheapModel: "cheap-model", simpleTaskMaxTokens: 500 },
    );
    expect(m).toBe("cheap-model");
  });

  it("returns default model when already using cheap model", () => {
    const m = resolveModel(
      { agentName: "a", defaultModel: "cheap-model", spentUsd: 0.9, budgetTotalUsd: 1.0 },
      { cheapModel: "cheap-model", budgetPressureThreshold: 0.8 },
    );
    expect(m).toBe("cheap-model");
  });
});
