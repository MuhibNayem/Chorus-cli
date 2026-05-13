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
  const dir = agentsDir(scope);
  const filePath = path.join(dir, `${agent.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ ...agent }, null, 2), "utf-8");
  return filePath;
}

export function deleteAgent(filePath: string): void {
  fs.unlinkSync(filePath);
}
