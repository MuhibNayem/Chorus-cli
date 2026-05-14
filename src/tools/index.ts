import { GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCommitTool } from "./git.js";
import { InternetSearchTool, WeatherTool } from "./web-search.js";
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
  WeatherTool,
];

export const gitTools = [GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCommitTool];
export const webSearchTools = [InternetSearchTool, WeatherTool];

export * from "./git.js";
export * from "./web-search.js";
export * from "./filesystem.js";
export * from "./shell.js";
