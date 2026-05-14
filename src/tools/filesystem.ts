import { tool } from "./tool.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { glob as globFn } from "glob";
import type { AgentTool } from "../agent/types.js";

/**
 * Create a set of filesystem tools whose access is sandboxed to `workspaceRoot`.
 * All path arguments are resolved relative to that root; paths outside it throw.
 *
 * Call this to give an isolated agent (e.g. a worktree-scoped builder) its own
 * safe filesystem tools instead of sharing the global process.cwd() tools.
 */
export function createFilesystemTools(workspaceRoot: string): AgentTool[] {
  const wsRoot = path.resolve(workspaceRoot);
  const wsSep = wsRoot.endsWith(path.sep) ? wsRoot : wsRoot + path.sep;

  function safePath(p: string): string {
    const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(wsRoot, p);
    if (resolved !== wsRoot && !resolved.startsWith(wsSep)) {
      throw new Error(
        `Access denied: "${p}" resolves to "${resolved}" which is outside the workspace (${wsRoot})`,
      );
    }
    return resolved;
  }

  const ReadFileTool = tool(
    async ({ path: filePath }: { path: string }) => {
      try {
        return fs.readFileSync(safePath(filePath), "utf-8");
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "file_read",
      description: "Read the contents of a file. Path is relative to the workspace.",
      schema: z.object({
        path: z.string().describe("File path (relative to workspace or absolute within workspace)"),
      }),
    },
  );

  const WriteFileTool = tool(
    async ({ path: filePath, content }: { path: string; content: string }) => {
      try {
        const abs = safePath(filePath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf-8");
        return `Written ${content.length} chars to ${filePath}`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "file_write",
      description: "Write content to a file, creating parent directories as needed.",
      schema: z.object({
        path: z.string().describe("File path (relative to workspace)"),
        content: z.string().describe("Full file content to write"),
      }),
    },
  );

  const EditFileTool = tool(
    async ({
      path: filePath,
      old_string,
      new_string,
    }: {
      path: string;
      old_string: string;
      new_string: string;
    }) => {
      try {
        const abs = safePath(filePath);
        const original = fs.readFileSync(abs, "utf-8");
        if (!original.includes(old_string)) {
          return `Error: old_string not found in ${filePath}`;
        }
        const updated = original.replace(old_string, new_string);
        fs.writeFileSync(abs, updated, "utf-8");
        return `Edited ${filePath}: replaced ${old_string.length} chars with ${new_string.length} chars`;
      } catch (err) {
        return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "file_edit",
      description: "Edit a file by replacing an exact string with a new string. Use for targeted edits.",
      schema: z.object({
        path: z.string().describe("File path (relative to workspace)"),
        old_string: z.string().describe("Exact string to find and replace"),
        new_string: z.string().describe("Replacement string"),
      }),
    },
  );

  const LsTool = tool(
    async ({ path: dirPath = "." }: { path?: string }) => {
      try {
        const abs = safePath(dirPath);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        const lines = entries.map((e) => {
          const indicator = e.isDirectory() ? "/" : e.isSymbolicLink() ? "@" : "";
          return `${e.name}${indicator}`;
        });
        return lines.join("\n") || "(empty directory)";
      } catch (err) {
        return `Error listing directory: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "list_dir",
      description:
        "List directory contents. Directories have a trailing /, symlinks @. Defaults to workspace root.",
      schema: z.object({
        path: z
          .string()
          .optional()
          .describe("Directory path (relative to workspace, default: workspace root)"),
      }),
    },
  );

  const GlobTool = tool(
    async ({ pattern }: { pattern: string }) => {
      try {
        const matches = await globFn(pattern, {
          cwd: wsRoot,
          nodir: false,
          dot: true,
        });
        if (matches.length === 0) return "(no matches)";
        return matches.join("\n");
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "find_files",
      description:
        "Find files matching a glob pattern relative to workspace. E.g. '**/*.ts', 'src/**/*.json'",
      schema: z.object({
        pattern: z.string().describe("Glob pattern to match files"),
      }),
    },
  );

  const GrepTool = tool(
    async ({ pattern, path: searchPath = "." }: { pattern: string; path?: string }) => {
      try {
        const abs = safePath(searchPath);
        const results: string[] = [];

        function searchDir(dir: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name === "node_modules" || entry.name === ".git") continue;
              searchDir(full);
            } else if (entry.isFile()) {
              try {
                const content = fs.readFileSync(full, "utf-8");
                const lines = content.split("\n");
                const re = new RegExp(pattern, "i");
                lines.forEach((line, i) => {
                  if (re.test(line)) {
                    const rel = path.relative(wsRoot, full);
                    results.push(`${rel}:${i + 1}: ${line.trim()}`);
                  }
                });
              } catch {
                // Skip unreadable files (binary, etc.)
              }
            }
          }
        }

        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          searchDir(abs);
        } else {
          const content = fs.readFileSync(abs, "utf-8");
          const re = new RegExp(pattern, "i");
          content.split("\n").forEach((line, i) => {
            if (re.test(line)) {
              results.push(`${path.relative(wsRoot, abs)}:${i + 1}: ${line.trim()}`);
            }
          });
        }

        if (results.length === 0) return "(no matches)";
        return results.slice(0, 200).join("\n");
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "search_files",
      description:
        "Search file contents for a regex pattern. Returns matching lines with file:line format.",
      schema: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z
          .string()
          .optional()
          .describe("File or directory to search (relative to workspace, default: workspace root)"),
      }),
    },
  );

  return [ReadFileTool, WriteFileTool, EditFileTool, LsTool, GlobTool, GrepTool];
}

// ─── Module-level singletons (backward compatible) ───────────────────────────

const _default = createFilesystemTools(process.cwd());
export const [ReadFileTool, WriteFileTool, EditFileTool, LsTool, GlobTool, GrepTool] = _default;
export const filesystemTools = _default;
