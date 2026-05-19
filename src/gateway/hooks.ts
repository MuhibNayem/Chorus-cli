import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface HookDef {
  name: string;
  events: string[];
  command: string;
  timeout?: number;
}

interface LoadedHook extends HookDef {
  args: string[];
}

function getHooksPath(): string {
  const dir = path.join(process.env.CHORUS_HOME_DIR ?? os.homedir(), ".chorus");
  return path.join(dir, "hooks.json");
}

let loaded: LoadedHook[] = [];

function parseCommand(command: string): { file: string; args: string[] } {
  const parts = command.trim().split(/\s+/);
  return { file: parts[0]!, args: parts.slice(1) };
}

export function loadHooks(): void {
  const hooksPath = getHooksPath();
  try {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks: HookDef[] };
    loaded = (parsed.hooks ?? []).map((h) => {
      const p = parseCommand(h.command);
      return {
        ...h,
        args: p.args,
        command: p.file,
        timeout: Math.min(h.timeout ?? 60, 300),
      };
    });
    if (loaded.length > 0) {
      console.log(`Chorus hooks: ${loaded.length} hook(s) loaded from ${hooksPath}`);
    }
  } catch {
    // hooks.json doesn't exist or is invalid — skip silently
    loaded = [];
  }
}

export function fireHook(event: string, payload: Record<string, unknown>): void {
  const matching = loaded.filter((h) => h.events.includes(event));
  if (matching.length === 0) return;

  const body = JSON.stringify({ event, ...payload, timestamp: Date.now() });

  for (const hook of matching) {
    const child = execFile(
      hook.command,
      hook.args,
      { timeout: hook.timeout! * 1000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = `Hook "${hook.name}" failed (event: ${event}): ${err.message}`;
          if ((err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            console.warn(`${msg} — output exceeded 1 MB`);
          } else {
            console.warn(msg);
          }
          if (stderr) console.warn(`Hook "${hook.name}" stderr: ${stderr.slice(0, 500)}`);
        }
      },
    );

    if (child.stdin) {
      child.stdin.write(body);
      child.stdin.end();
    }
  }
}

export function disposeHooks(): void {
  loaded = [];
}
