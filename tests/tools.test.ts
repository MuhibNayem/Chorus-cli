import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecuteTool, GrepTool, InternetSearchTool } from "../src/tools/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SERPER_API_KEY;
  delete process.env.GOOGLE_CSE_API_KEY;
  delete process.env.GOOGLE_CSE_ID;
});

describe("ExecuteTool", () => {
  it("runs a simple allowed command without shell interpolation", async () => {
    const result = await ExecuteTool.invoke({ command: "echo hello" });
    expect(result).toBe("hello");
  });

  it("blocks shell operators and command substitution", async () => {
    await expect(ExecuteTool.invoke({ command: "echo hello; echo bad" })).resolves.toContain(
      "Blocked: shell operators"
    );
    await expect(ExecuteTool.invoke({ command: "echo $(pwd)" })).resolves.toContain(
      "Blocked: shell operators"
    );
  });

  it("blocks inline code execution flags for interpreter commands", async () => {
    await expect(ExecuteTool.invoke({ command: "python -c \"print(1)\"" })).resolves.toContain(
      "can execute arbitrary inline code"
    );
    await expect(ExecuteTool.invoke({ command: "node -e \"console.log(1)\"" })).resolves.toContain(
      "can execute arbitrary inline code"
    );
  });

  it("blocks paths outside the workspace", async () => {
    const result = await ExecuteTool.invoke({ command: "cat /etc/passwd" });
    expect(result).toContain("outside the workspace");
  });

  it("blocks destructive git commands and dependency mutations", async () => {
    await expect(ExecuteTool.invoke({ command: "git reset --hard" })).resolves.toContain(
      "Blocked destructive git command"
    );
    await expect(ExecuteTool.invoke({ command: "npm install left-pad" })).resolves.toContain(
      "Blocked dependency mutation command"
    );
  });
});

describe("GrepTool", () => {
  it("searches the workspace when path is omitted", async () => {
    const result = await GrepTool.invoke({ pattern: "ExecuteTool" });
    expect(result).not.toContain("EISDIR");
    expect(result).toContain("tests/tools.test.ts");
  });
});

describe("InternetSearchTool", () => {
  it("uses Serper organic results", async () => {
    process.env.SERPER_API_KEY = "serper-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: [{ title: "Result A", snippet: "Snippet A", link: "https://example.com/a" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await InternetSearchTool.invoke({ query: "example", maxResults: 5 });

    expect(result).toContain("Source: Serper");
    expect(result).toContain("Result A");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Google CSE when Serper has no results", async () => {
    process.env.SERPER_API_KEY = "serper-key";
    process.env.GOOGLE_CSE_API_KEY = "google-key";
    process.env.GOOGLE_CSE_ID = "google-cx";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organic: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ title: "Fallback", snippet: "Fallback snippet", link: "https://example.com/fallback" }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await InternetSearchTool.invoke({ query: "example", maxResults: 5 });

    expect(result).toContain("Source: Google CSE fallback");
    expect(result).toContain("Fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
