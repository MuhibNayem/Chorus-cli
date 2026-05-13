import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { SessionData, SessionIndex, SessionMetadata } from "./types.js";

function getSessionsDir(): string {
  const dir = path.join(os.homedir(), ".chorus", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(): string {
  return path.join(getSessionsDir(), "index.json");
}

function sessionPath(id: string): string {
  return path.join(getSessionsDir(), `${id}.json`);
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function loadIndex(): SessionIndex {
  const p = indexPath();
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as SessionIndex;
  } catch {
    return { sessions: [] };
  }
}

export function saveIndex(index: SessionIndex): void {
  atomicWrite(indexPath(), index);
}

export function loadSession(id: string): SessionData | null {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(id), "utf-8")) as SessionData;
  } catch {
    return null;
  }
}

export function saveSession(data: SessionData): void {
  atomicWrite(sessionPath(data.id), data);

  const index = loadIndex();
  const meta: SessionMetadata = {
    id:           data.id,
    name:         data.name,
    workspace:    data.workspace,
    createdAt:    data.createdAt,
    updatedAt:    data.updatedAt,
    messageCount: data.messageCount,
    isCompacted:  data.isCompacted,
  };
  const existing = index.sessions.findIndex((s) => s.id === data.id);
  if (existing >= 0) {
    index.sessions[existing] = meta;
  } else {
    index.sessions.push(meta);
  }
  saveIndex(index);
}

export function deleteSession(id: string): void {
  try { fs.unlinkSync(sessionPath(id)); } catch { /* already gone */ }
  const index = loadIndex();
  index.sessions = index.sessions.filter((s) => s.id !== id);
  saveIndex(index);
}

export function listSessionsForWorkspace(workspace: string): SessionMetadata[] {
  return loadIndex()
    .sessions.filter((s) => s.workspace === workspace)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
