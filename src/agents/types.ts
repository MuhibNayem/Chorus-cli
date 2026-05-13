export interface AgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  source: "project" | "user";
  filePath: string;
}
