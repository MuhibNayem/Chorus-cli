import { describe, expect, it } from "vitest";
import { ExecuteTool, GrepTool } from "../src/tools/index.js";

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
