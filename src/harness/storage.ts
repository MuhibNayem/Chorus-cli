import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ContextBundle, HarnessRunRecord, TaskRecord, WorkerAssignment } from "./types.js";

function harnessDir(): string {
  const dir = path.join(os.homedir(), ".chorus", "harness");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runPath(taskId: string): string {
  return path.join(harnessDir(), `${taskId}.json`);
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function saveHarnessRun(record: HarnessRunRecord): void {
  atomicWrite(runPath(record.task.taskId), record);
}

export function loadHarnessRun(taskId: string): HarnessRunRecord | null {
  try {
    return JSON.parse(fs.readFileSync(runPath(taskId), "utf-8")) as HarnessRunRecord;
  } catch {
    return null;
  }
}

export function listHarnessRuns(): HarnessRunRecord[] {
  try {
    return fs.readdirSync(harnessDir())
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(fs.readFileSync(path.join(harnessDir(), file), "utf-8")) as HarnessRunRecord)
      .sort((a, b) => b.task.createdAt - a.task.createdAt);
  } catch {
    return [];
  }
}

export function createHarnessRunRecord(input: {
  task: TaskRecord;
  route: HarnessRunRecord["route"];
  contextBundle: ContextBundle;
  workerAssignments: WorkerAssignment[];
  protocol?: HarnessRunRecord["protocol"];
  repoIntelligence?: HarnessRunRecord["repoIntelligence"];
  projectMemory?: HarnessRunRecord["projectMemory"];
}): HarnessRunRecord {
  return {
    task: input.task,
    route: input.route,
    protocol: input.protocol,
    repoIntelligence: input.repoIntelligence,
    projectMemory: input.projectMemory,
    contextBundle: input.contextBundle,
    workerAssignments: input.workerAssignments,
    workerResults: [],
  };
}
