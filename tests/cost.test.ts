import { describe, it, expect } from "vitest";
import { feedReducer, initialFeedState, type FeedAction } from "../src/cli/state/feedReducer.js";

describe("ADD_USAGE reducer action", () => {
  it("accumulates input tokens, output tokens, and cost", () => {
    const action1: FeedAction = { type: "ADD_USAGE", inputTokens: 100, outputTokens: 50, cost: 0.001 };
    const action2: FeedAction = { type: "ADD_USAGE", inputTokens: 200, outputTokens: 80, cost: 0.003 };

    let state = feedReducer(initialFeedState, action1);
    expect(state.totalInputTokens).toBe(100);
    expect(state.totalOutputTokens).toBe(50);
    expect(state.totalCost).toBeCloseTo(0.001);

    state = feedReducer(state, action2);
    expect(state.totalInputTokens).toBe(300);
    expect(state.totalOutputTokens).toBe(130);
    expect(state.totalCost).toBeCloseTo(0.004);
  });

  it("starts at zero", () => {
    expect(initialFeedState.totalCost).toBe(0);
    expect(initialFeedState.totalInputTokens).toBe(0);
    expect(initialFeedState.totalOutputTokens).toBe(0);
  });

  it("cost accumulates across multiple turns", () => {
    const actions: FeedAction[] = [
      { type: "ADD_USAGE", inputTokens: 500, outputTokens: 100, cost: 0.005 },
      { type: "ADD_USAGE", inputTokens: 300, outputTokens: 200, cost: 0.007 },
      { type: "ADD_USAGE", inputTokens: 100, outputTokens: 50,  cost: 0.002 },
    ];
    const finalState = actions.reduce(feedReducer, initialFeedState);
    expect(finalState.totalInputTokens).toBe(900);
    expect(finalState.totalOutputTokens).toBe(350);
    expect(finalState.totalCost).toBeCloseTo(0.014);
  });
});
