import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentDef } from "./types.js";

function agentsDir(scope: "user" | "project"): string {
  const base = scope === "user" ? os.homedir() : process.cwd();
  const dir = path.join(base, ".chorus", "agents");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveAgent(agent: Omit<AgentDef, "filePath" | "source">, scope: "user" | "project" = "user"): string {
  // Reject names containing path separators or traversal sequences
  const safeName = path.basename(agent.name);
  if (!safeName || safeName !== agent.name || safeName.includes("..")) {
    throw new Error(`Invalid agent name: "${agent.name}". Names must not contain path separators or traversal sequences.`);
  }
  const dir = agentsDir(scope);
  const filePath = path.join(dir, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ ...agent }, null, 2), "utf-8");
  return filePath;
}

export function deleteAgent(filePath: string): void {
  fs.unlinkSync(filePath);
}
