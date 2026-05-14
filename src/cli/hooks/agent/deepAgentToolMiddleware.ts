import { ToolMessage, createMiddleware } from "langchain";
import * as path from "path";

const WORKSPACE = process.cwd();
const WORKSPACE_SEP = WORKSPACE.endsWith(path.sep) ? WORKSPACE : WORKSPACE + path.sep;

function normalizeWorkspacePath(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;

  if (path.isAbsolute(value)) {
    const resolved = path.resolve(value);
    if (resolved === WORKSPACE) return "/";
    if (resolved.startsWith(WORKSPACE_SEP)) {
      return `/${path.relative(WORKSPACE, resolved).split(path.sep).join("/")}`;
    }
    return value;
  }

  return value.startsWith("/") ? value : `/${value}`;
}

function normalizeArgs(toolName: string | undefined, args: unknown): Record<string, any> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const normalized: Record<string, unknown> = { ...(args as Record<string, unknown>) };

  if (["read_file", "write_file", "edit_file"].includes(toolName ?? "")) {
    if (normalized.file_path === undefined && normalized.path !== undefined) {
      normalized.file_path = normalized.path;
      delete normalized.path;
    }
    normalized.file_path = normalizeWorkspacePath(normalized.file_path);
  }

  if (["ls", "grep", "glob"].includes(toolName ?? "") && normalized.path !== undefined) {
    normalized.path = normalizeWorkspacePath(normalized.path);
  }

  return normalized as Record<string, any>;
}

export const normalizeDeepAgentToolArgsMiddleware = createMiddleware({
  name: "normalize_deepagent_tool_args",
  wrapToolCall: async (request, handler) => {
    const toolCall = {
      ...request.toolCall,
      args: normalizeArgs(request.toolCall.name, request.toolCall.args),
    };

    try {
      return await handler({ ...request, toolCall });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? `tool-${Date.now()}`,
        content: `Tool execution failed for ${request.toolCall.name}: ${message}`,
      });
    }
  },
});
