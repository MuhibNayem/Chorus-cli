import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface CommandSafetyResult {
  ok: boolean;
  reason?: string;
}

const DESTRUCTIVE_FLAGS: Record<string, Set<string>> = {
  rm: new Set(["-rf", "-fr", "-r", "-f", "--recursive", "--force"]),
  git: new Set(["push", "reset", "clean", "checkout"]),
};

const DESTRUCTIVE_GIT_SUBCOMMANDS = new Set(["push", "reset", "clean"]);
const DESTRUCTIVE_GIT_CHECKOUT_FLAGS = new Set(["-f", "--force"]);

export function assessCommandSafety(base: string, args: string[]): CommandSafetyResult {
  if (base === "rm") {
    const flags = DESTRUCTIVE_FLAGS["rm"];
    for (const arg of args) {
      if (flags?.has(arg)) {
        return { ok: false, reason: `Blocked: "rm ${arg}" is a destructive operation.` };
      }
    }
  }

  if (base === "git" && args[0]) {
    if (DESTRUCTIVE_GIT_SUBCOMMANDS.has(args[0])) {
      return { ok: false, reason: `Blocked destructive git command: git ${args[0]}` };
    }
    if (args[0] === "checkout" && args.some((arg) => DESTRUCTIVE_GIT_CHECKOUT_FLAGS.has(arg))) {
      return { ok: false, reason: "Blocked destructive git command: git checkout --force" };
    }
  }

  return { ok: true };
}

export function auditCommand(entry: { command: string; allowed: boolean; reason?: string }): void {
  if (process.env.CHORUS_AUDIT !== "1") return;
  try {
    const dir = path.join(os.homedir(), ".chorus");
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      command: entry.command,
      allowed: entry.allowed,
      reason: entry.reason,
    }) + "\n";
    fs.appendFileSync(path.join(dir, "command-audit.ndjson"), line);
  } catch { /* never crash on audit log */ }
}
