import { describe, expect, it } from "vitest";
import { getContextWindow, formatContextWindow, DEFAULT_CONTEXT_WINDOW } from "../src/llm/contextWindows.js";

describe("getContextWindow", () => {
  it("returns exact match for known models", () => {
    expect(getContextWindow("gpt-4o", "openai")).toBe(128_000);
    expect(getContextWindow("deepseek-chat", "deepseek")).toBe(128_000);
    expect(getContextWindow("kimi-k2.6", "kimi")).toBe(262_144);
    expect(getContextWindow("gemini-1.5-pro-latest", "gemini")).toBe(1_000_000);
    expect(getContextWindow("claude-3-5-sonnet-20241022", "anthropic")).toBe(200_000);
    expect(getContextWindow("llama-3.3-70b-versatile", "groq")).toBe(131_072);
    expect(getContextWindow("MiniMax-M2.7", "minimax")).toBe(204_800);
  });

  it("returns 1M for DeepSeek V4 models", () => {
    expect(getContextWindow("deepseek-v4-pro", "deepseek")).toBe(1_000_000);
    expect(getContextWindow("deepseek-v4-flash", "deepseek")).toBe(1_000_000);
  });

  it("falls back to provider default when model is unknown", () => {
    expect(getContextWindow("some-unknown-model", "gemini")).toBe(1_000_000);
    expect(getContextWindow("some-unknown-model", "kimi")).toBe(262_144);
    expect(getContextWindow("some-unknown-model", "deepseek")).toBe(128_000);
  });

  it("falls back to global default when provider is also unknown", () => {
    expect(getContextWindow("unknown-model", "unknown-provider")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(getContextWindow("unknown-model")).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("matches by prefix for model variants", () => {
    // gpt-4o-2024-08-06 should match gpt-4o
    expect(getContextWindow("gpt-4o-2024-08-06", "openai")).toBe(128_000);
    // claude-3-5-sonnet should match claude-3-5-sonnet-20241022 prefix
    expect(getContextWindow("claude-3-5-sonnet-20241022", "anthropic")).toBe(200_000);
  });

  it("is case-insensitive", () => {
    expect(getContextWindow("GPT-4O", "openai")).toBe(128_000);
    expect(getContextWindow("Kimi-K2.6", "kimi")).toBe(262_144);
    expect(getContextWindow("DEEPSEEK-CHAT", "deepseek")).toBe(128_000);
  });
});

describe("formatContextWindow", () => {
  it("formats millions correctly", () => {
    expect(formatContextWindow(1_000_000)).toBe("1.0M");
    expect(formatContextWindow(2_000_000)).toBe("2.0M");
    expect(formatContextWindow(1_048_576)).toBe("1.0M");
  });

  it("formats thousands correctly", () => {
    expect(formatContextWindow(128_000)).toBe("128K");
    expect(formatContextWindow(200_000)).toBe("200K");
    expect(formatContextWindow(262_144)).toBe("262K");
  });

  it("formats small numbers correctly", () => {
    expect(formatContextWindow(500)).toBe("500");
    expect(formatContextWindow(999)).toBe("999");
  });
});
