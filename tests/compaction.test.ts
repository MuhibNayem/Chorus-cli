import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shouldCompact,
  compactMessages,
  trimToWindow,
  COMPACTION_THRESHOLD,
  KEEP_RECENT_TOKENS,
} from "../src/context/compaction.js";

// Mock tokenizer so tests don't need tiktoken
vi.mock("../src/context/tokenizer.js", () => ({
  countTokens: async (text: string) => Math.ceil(text.length / 4),
  countMessagesTokens: async (messages: Array<{ role: string; content: string }>, system: string) => {
    let total = Math.ceil(system.length / 4);
    for (const m of messages) total += Math.ceil((m.role.length + m.content.length) / 4);
    return total;
  },
}));

// Mock streamOllama so no HTTP calls
vi.mock("../src/ollama/client.js", () => ({
  streamOllama: ({ onResponse, onComplete }: any) => {
    onResponse("Test summary.");
    onComplete?.();
  },
}));

vi.mock("../src/llm/retry.js", () => ({
  withRetry: async (fn: () => Promise<unknown>) => fn(),
}));

const SYSTEM = "sys";
const makeMsg = (role: string, len: number) => ({ role, content: "x".repeat(len) });

describe("shouldCompact", () => {
  it("returns false when tokens are below threshold", async () => {
    const msgs = [makeMsg("user", 100)];
    expect(await shouldCompact(msgs, SYSTEM)).toBe(false);
  });

  it("returns true when tokens exceed COMPACTION_THRESHOLD", async () => {
    // Each char ≈ 0.25 tokens; need 100_000 tokens = 400_000 chars
    const msgs = [makeMsg("user", 400_000)];
    expect(await shouldCompact(msgs, SYSTEM)).toBe(true);
  });
});

describe("trimToWindow", () => {
  it("returns messages unchanged if already under budget", async () => {
    const msgs = [makeMsg("user", 10), makeMsg("assistant", 10)];
    const result = await trimToWindow(msgs, SYSTEM, 10_000);
    expect(result).toHaveLength(2);
  });

  it("drops oldest non-system messages until under budget", async () => {
    // 5 messages, each ≈ 250 tokens (1000 chars). Budget = 500 tokens.
    const msgs = [
      makeMsg("user", 1000),
      makeMsg("assistant", 1000),
      makeMsg("user", 1000),
      makeMsg("assistant", 1000),
      makeMsg("user", 1000),
    ];
    const result = await trimToWindow(msgs, SYSTEM, 500);
    // Should drop messages until count < 500 tokens
    expect(result.length).toBeLessThan(msgs.length);
  });

  it("preserves system messages and drops user/assistant", async () => {
    const msgs = [
      makeMsg("system", 10),
      makeMsg("user", 1000),
      makeMsg("assistant", 1000),
    ];
    const result = await trimToWindow(msgs, SYSTEM, 100);
    // system message should be retained
    expect(result.some((m) => m.role === "system")).toBe(true);
  });
});

describe("compactMessages", () => {
  it("returns a summary string", async () => {
    const msgs = [makeMsg("user", 100), makeMsg("assistant", 100)];
    const result = await compactMessages(msgs, SYSTEM);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.originalCount).toBeGreaterThan(0);
  });
});
