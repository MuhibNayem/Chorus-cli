export interface AgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  source: "project" | "user";
  filePath: string;
  /**
   * Tool names to grant this agent. Defaults to filesystem + git tools when omitted.
   * Available names: file_read, file_write, file_edit, list_dir, find_files, search_files,
   * git_status, git_diff, git_log, git_branch, git_commit,
   * internet_search, run_command
   */
  tools?: string[];
  /** Permission mode for this agent. Defaults to "full_auto". */
  permissionMode?: "suggest" | "auto_edit" | "full_auto";
  /** Max agent loop rounds. Defaults to 30. */
  maxRounds?: number;
}
