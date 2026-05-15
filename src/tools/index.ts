import { GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCommitTool } from "./git.js";
import { InternetSearchTool, WeatherTool } from "./web-search.js";
import { shellTools } from "./shell.js";
import { WriteTodosTool } from "./todos.js";

export const allTools = [
  // DeepAgents provides filesystem tools: ls, read_file, write_file, edit_file, glob, grep.
  // Avoid registering a second filesystem API with different schemas.
  // Shell execution (safe allowlist)
  ...shellTools,
  // Git
  GitStatusTool,
  GitDiffTool,
  GitLogTool,
  GitBranchTool,
  GitCommitTool,
  // Web
  InternetSearchTool,
  WeatherTool,
  // Task planning
  WriteTodosTool,
];

export const gitTools = [GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCommitTool];
export const webSearchTools = [InternetSearchTool, WeatherTool];

export * from "./git.js";
export * from "./web-search.js";
export * from "./filesystem.js";
export * from "./shell.js";
export * from "./todos.js";
