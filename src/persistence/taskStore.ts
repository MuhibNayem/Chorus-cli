/**
 * Persistent task store — survives daemon restarts.
 *
 * Backed by a JSON file at ~/.chorus/tasks.json with atomic writes.
 * Extends the A2A Task type with fields needed for autonomous operation:
 *   scheduledFor  — Unix ms; task won't execute until this time
 *   cronExpr      — standard 5-field cron; creates the next run on completion
 *   goalCondition — natural-language goal; judge model re-queues until met
 *   outputText    — accumulated agent output from the latest run
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { TaskState, TaskMessage } from "../a2a/types.js";

export interface PersistedTask {
  id: string;
  agentId: string;
  state: TaskState;
  messages: TaskMessage[];
  createdAt: number;
  updatedAt: number;
  /** Unix ms — if set the scheduler won't pick up this task before this time. */
  scheduledFor?: number;
  /** Standard 5-field cron expression ("15 9 * * 1-5"). Recurring tasks. */
  cronExpr?: string;
  /** Natural-language completion condition. Scheduler re-queues until judge says done. */
  goalCondition?: string;
  /** Accumulated text output from the latest agent run. */
  outputText?: string;
  /** Arbitrary caller metadata (e.g. Telegram chatId for notifications). */
  metadata?: Record<string, unknown>;
}

type TaskDb = Record<string, PersistedTask>;

function getDbPath(): string {
  const dir = path.join(process.env.CHORUS_HOME_DIR ?? os.homedir(), ".chorus");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "tasks.json");
}

function load(): TaskDb {
  try {
    return JSON.parse(fs.readFileSync(getDbPath(), "utf-8")) as TaskDb;
  } catch {
    return {};
  }
}

function save(db: TaskDb): void {
  const p = getDbPath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

export const taskStore = {
  create(task: PersistedTask): void {
    const db = load();
    db[task.id] = task;
    save(db);
  },

  get(id: string): PersistedTask | undefined {
    return load()[id];
  },

  update(id: string, patch: Partial<PersistedTask>): PersistedTask | undefined {
    const db = load();
    const existing = db[id];
    if (!existing) return undefined;
    db[id] = { ...existing, ...patch, updatedAt: Date.now() };
    save(db);
    return db[id];
  },

  list(): PersistedTask[] {
    return Object.values(load());
  },

  /** Tasks that are queued and due to run right now. */
  listDue(): PersistedTask[] {
    const now = Date.now();
    return Object.values(load()).filter(
      (t) => t.state === "queued" && (t.scheduledFor === undefined || t.scheduledFor <= now),
    );
  },

  /** All tasks with a cron expression (for scheduler bookkeeping). */
  listRecurring(): PersistedTask[] {
    return Object.values(load()).filter((t) => t.cronExpr !== undefined);
  },

  delete(id: string): void {
    const db = load();
    delete db[id];
    save(db);
  },
};
