import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { sessionManager } from "../session/manager.js";

export type ApprovalDecision = "approve" | "approve_session" | "deny" | "skip";

export interface ApprovalLogEntry {
  timestamp: string;
  tool: string;
  args: unknown;
  decision: ApprovalDecision;
  sessionId?: string;
}

function getLogPath(): string {
  const dir = path.join(os.homedir(), ".chorus");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "approval-log.ndjson");
}

export function appendApprovalLog(entry: Omit<ApprovalLogEntry, "timestamp" | "sessionId">): void {
  const full: ApprovalLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    sessionId: sessionManager.getCurrent()?.id,
  };
  try {
    fs.appendFileSync(getLogPath(), JSON.stringify(full) + "\n", "utf-8");
  } catch { /* never crash on audit logging */ }
}

export function readApprovalLog(limit = 50): ApprovalLogEntry[] {
  try {
    const raw = fs.readFileSync(getLogPath(), "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try { return JSON.parse(line) as ApprovalLogEntry; } catch { return null; }
      })
      .filter((e): e is ApprovalLogEntry => e !== null);
  } catch {
    return [];
  }
}
