import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentTool } from "../agent/types.js";
import type { ContextMode, SwarmAgent } from "./types.js";

interface SwarmAgentFile {
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  handoffDestinations?: string[];
  contextMode?: ContextMode;
  maxRounds?: number;
  tools?: string[];
}

function parseSwarmAgentFile(filePath: string): SwarmAgent | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<SwarmAgentFile>;
    if (!raw.name || !raw.systemPrompt) return null;
    return {
      name: raw.name,
      description: raw.description ?? "",
      systemPrompt: raw.systemPrompt,
      model: raw.model,
      tools: [] as AgentTool[],
      handoffDestinations: raw.handoffDestinations ?? [],
      contextMode: raw.contextMode ?? "isolated",
      maxRounds: raw.maxRounds ?? 50,
    };
  } catch {
    return null;
  }
}

function loadFromDir(dir: string): SwarmAgent[] {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseSwarmAgentFile(path.join(dir, f)))
      .filter((a): a is SwarmAgent => a !== null);
  } catch {
    return [];
  }
}

export function loadSwarmAgents(): SwarmAgent[] {
  const chorusHome = process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
  const userDir = path.join(chorusHome, "swarm-agents");
  const projectDir = path.join(process.cwd(), ".chorus", "swarm-agents");
  return [
    ...loadFromDir(userDir),
    ...loadFromDir(projectDir),
  ];
}

export function findSwarmAgent(name: string): SwarmAgent | undefined {
  return loadSwarmAgents().find((a) => a.name === name);
}
