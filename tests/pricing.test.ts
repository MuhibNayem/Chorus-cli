import { describe, it, expect } from "vitest";
import { estimateCost, formatCost, costColor } from "../src/llm/pricing.js";

describe("estimateCost", () => {
  it("returns 0 for local/Ollama models", () => {
    expect(estimateCost("batiai/gemma4-e2b:q4", 10_000, 2_000)).toBe(0);
    expect(estimateCost("llama3:8b", 10_000, 2_000)).toBe(0);
    expect(estimateCost("ollama/llama3", 10_000, 2_000)).toBe(0);
  });

  it("calculates cost for known OpenAI models", () => {
    // gpt-4o: $5/1M input + $15/1M output
    // 1M input + 1M output = $20 total
    const cost = estimateCost("openai/gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(20, 1);
  });

  it("calculates cost for deepseek", () => {
    // deepseek-chat: $0.14/1M input + $0.28/1M output
    const cost = estimateCost("deepseek/deepseek-chat", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.42, 2);
  });

  it("returns 0 for unknown models (no pricing data)", () => {
    const cost = estimateCost("unknown/some-model", 1_000_000, 1_000_000);
    expect(cost).toBe(0);
  });
});

describe("formatCost", () => {
  it("formats zero as $0.000", () => {
    expect(formatCost(0)).toBe("$0.000");
  });

  it("formats sub-cent costs with 4 decimal places", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("formats larger amounts with 3 decimal places", () => {
    expect(formatCost(0.123)).toBe("$0.123");
    expect(formatCost(1.5)).toBe("$1.500");
  });
});

describe("costColor", () => {
  it("returns green for < $0.05", () => {
    expect(costColor(0)).toBe("green");
    expect(costColor(0.04)).toBe("green");
  });

  it("returns yellow for $0.05-$0.20", () => {
    expect(costColor(0.05)).toBe("yellow");
    expect(costColor(0.19)).toBe("yellow");
  });

  it("returns red for >= $0.20", () => {
    expect(costColor(0.20)).toBe("red");
    expect(costColor(1.00)).toBe("red");
  });
});
