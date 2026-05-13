import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CompletedTaskExecution, HarnessMetrics, PreparedTaskExecution } from "./types.js";

function metricsPath(): string {
  const dir = path.join(os.homedir(), ".chorus", "harness");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "metrics.json");
}

function emptyMetrics(): HarnessMetrics {
  return {
    tasksStarted: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    modelCalls: 0,
    verifierFailures: 0,
    workerAssignments: 0,
    routes: {},
    lanes: {},
    totalDurationMs: 0,
    updatedAt: Date.now(),
  };
}

function readMetrics(): HarnessMetrics {
  try {
    return { ...emptyMetrics(), ...JSON.parse(fs.readFileSync(metricsPath(), "utf-8")) };
  } catch {
    return emptyMetrics();
  }
}

function writeMetrics(metrics: HarnessMetrics): void {
  const p = metricsPath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(metrics, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

export function recordTaskStarted(prepared: PreparedTaskExecution): void {
  const metrics = readMetrics();
  metrics.tasksStarted += 1;
  metrics.workerAssignments += prepared.workerAssignments.length;
  increment(metrics.routes, prepared.route.path);
  increment(metrics.lanes, prepared.route.lane);
  metrics.updatedAt = Date.now();
  writeMetrics(metrics);
}

export function recordTaskCompleted(completion: CompletedTaskExecution): void {
  const metrics = readMetrics();
  if (completion.verification.ok) {
    metrics.tasksCompleted += 1;
  } else {
    metrics.tasksFailed += 1;
    metrics.verifierFailures += 1;
  }
  metrics.modelCalls += completion.modelCalls;
  metrics.totalDurationMs += completion.durationMs;
  metrics.updatedAt = Date.now();
  writeMetrics(metrics);
}

export function loadHarnessMetrics(): HarnessMetrics {
  return readMetrics();
}
