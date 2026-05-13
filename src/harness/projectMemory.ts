import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import type { ProjectMemory, TaskKind } from "./types.js";

const MEMORY_VERSION = 1;
const MAX_COMPLETED_TASKS = 50;

function memoryDir(): string {
  const dir = path.join(os.homedir(), ".chorus", "memory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function workspaceKey(): string {
  return createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
}

function memoryPath(): string {
  return path.join(memoryDir(), `${workspaceKey()}.json`);
}

function emptyMemory(): ProjectMemory {
  return {
    version: MEMORY_VERSION,
    workspace: process.cwd(),
    decisions: [],
    knownIssues: [],
    completedTasks: [],
    updatedAt: Date.now(),
  };
}

export function loadProjectMemory(): ProjectMemory {
  try {
    const raw = JSON.parse(fs.readFileSync(memoryPath(), "utf-8")) as ProjectMemory;
    return { ...emptyMemory(), ...raw };
  } catch {
    return emptyMemory();
  }
}

function saveProjectMemory(memory: ProjectMemory): void {
  const p = memoryPath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(memory, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

export function rememberCompletedTask(input: {
  taskId: string;
  kind: TaskKind;
  summary: string;
}): ProjectMemory {
  const memory = loadProjectMemory();
  memory.completedTasks.unshift({
    taskId: input.taskId,
    kind: input.kind,
    summary: input.summary.slice(0, 300),
    completedAt: Date.now(),
  });
  if (memory.completedTasks.length > MAX_COMPLETED_TASKS) {
    memory.completedTasks = memory.completedTasks.slice(0, MAX_COMPLETED_TASKS);
  }
  memory.updatedAt = Date.now();
  saveProjectMemory(memory);
  return memory;
}

export function addDecision(decision: string): void {
  const memory = loadProjectMemory();
  memory.decisions.unshift(decision.slice(0, 200));
  if (memory.decisions.length > 20) memory.decisions = memory.decisions.slice(0, 20);
  memory.updatedAt = Date.now();
  saveProjectMemory(memory);
}

export function addKnownIssue(issue: string): void {
  const memory = loadProjectMemory();
  memory.knownIssues.unshift(issue.slice(0, 200));
  if (memory.knownIssues.length > 20) memory.knownIssues = memory.knownIssues.slice(0, 20);
  memory.updatedAt = Date.now();
  saveProjectMemory(memory);
}
