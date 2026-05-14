import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentDef } from "./types.js";

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

function parseAgentFile(filePath: string, source: AgentDef["source"]): AgentDef | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<AgentDef>;
    if (!raw.name || !raw.systemPrompt) return null;
    return {
      name: raw.name,
      description: raw.description ?? "",
      systemPrompt: raw.systemPrompt,
      model: raw.model,
      source,
      filePath,
      tools: raw.tools,
      permissionMode: raw.permissionMode,
      maxRounds: raw.maxRounds,
    };
  } catch {
    return null;
  }
}

function loadFromDir(dir: string, source: AgentDef["source"]): AgentDef[] {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseAgentFile(path.join(dir, f), source))
      .filter((a): a is AgentDef => a !== null);
  } catch {
    return [];
  }
}

export function loadAgents(): AgentDef[] {
  const userDir = path.join(chorusHome(), "agents");
  const projectDir = path.join(process.cwd(), ".chorus", "agents");
  return [
    ...loadFromDir(userDir, "user"),
    ...loadFromDir(projectDir, "project"),
  ];
}
