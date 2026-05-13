import { GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCommitTool } from "./git.js";
import { InternetSearchTool, WebSearchTool, WeatherTool } from "./web-search.js";
import { filesystemTools } from "./filesystem.js";
import { shellTools } from "./shell.js";

export const allTools = [
  // Filesystem (workspace-confined)
  ...filesystemTools,
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
  WebSearchTool,
  WeatherTool,
];

export const gitTools = [GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCommitTool];
export const webSearchTools = [InternetSearchTool, WebSearchTool, WeatherTool];

export * from "./git.js";
export * from "./web-search.js";
export * from "./filesystem.js";
export * from "./shell.js";
