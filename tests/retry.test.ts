import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/llm/retry.js";

describe("withRetry", () => {
  it("succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("429 rate limited");
      return "success";
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("SyntaxError: bad JSON"));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow("SyntaxError");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all attempts on retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses default maxAttempts of 3", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
