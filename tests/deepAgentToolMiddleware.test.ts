import { describe, expect, it } from "vitest";
import { normalizeDeepAgentToolArgsMiddleware } from "../src/cli/hooks/agent/deepAgentToolMiddleware.js";

describe("normalizeDeepAgentToolArgsMiddleware", () => {
  it("normalizes read_file path args to DeepAgents file_path args", async () => {
    const result = await normalizeDeepAgentToolArgsMiddleware.wrapToolCall!(
      {
        toolCall: {
          id: "call-1",
          name: "read_file",
          args: { path: "src/main.py" },
        },
        tool: undefined,
        state: { messages: [] },
        runtime: {},
      } as any,
      async (request: any) => {
        return {
          tool_call_id: request.toolCall.id,
          content: JSON.stringify(request.toolCall.args),
        } as any;
      }
    );

    expect(result.content).toBe(JSON.stringify({ file_path: "/src/main.py" }));
  });

  it("returns a tool message instead of throwing when tool execution fails", async () => {
    const result = await normalizeDeepAgentToolArgsMiddleware.wrapToolCall!(
      {
        toolCall: {
          id: "call-1",
          name: "read_file",
          args: { path: "src/main.py" },
        },
        tool: undefined,
        state: { messages: [] },
        runtime: {},
      } as any,
      async () => {
        throw new Error("schema validation failed");
      }
    );

    expect(result.content).toContain("Tool execution failed for read_file");
    expect(result.content).toContain("schema validation failed");
  });
});
