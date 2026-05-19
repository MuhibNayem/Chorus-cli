/**
 * Chorus autonomous scheduler.
 *
 * Polls the persistent task store every POLL_INTERVAL_MS and executes queued
 * tasks that are due. Three autonomous behaviors are supported:
 *
 *   One-shot scheduled   — scheduledFor is set, runs once at that time.
 *   Recurring (cron)     — cronExpr is set; after each run the next occurrence
 *                          is queued automatically.
 *   Goal-driven          — goalCondition is set; after each run the judge LLM
 *                          checks if the goal is met. If not, re-queues in
 *                          GOAL_RETRY_MINUTES minutes.
 *
 * Concurrency is capped at MAX_CONCURRENT to avoid overwhelming the LLM.
 * Task IDs in `inFlight` prevent the same task from being picked up twice
 * even if a poll fires while the task is still running.
 */

import { randomUUID } from "crypto";
import { taskStore, type PersistedTask } from "../persistence/taskStore.js";
import { runHeadlessAgent } from "../a2a/headless-runner.js";
import { nextRun } from "./cron.js";
import { isGoalMet } from "./goalJudge.js";
import { globalBroadcaster } from "../channels/broadcaster.js";
import { fireHook } from "../gateway/hooks.js";
import type { TaskMessage } from "../a2a/types.js";

const POLL_INTERVAL_MS    = 30_000; // 30 s
const GOAL_RETRY_MINUTES  = 5;
const MAX_CONCURRENT      = 3;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Set<string>();
  private agentId: string;
  private onTaskComplete: ((task: PersistedTask, output: string, error?: string) => void) | null = null;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  setNotifier(fn: (task: PersistedTask, output: string, error?: string) => void): void {
    this.onTaskComplete = fn;
  }

  start(): void {
    if (this.timer) return;
    console.log(`Chorus scheduler started (poll every ${POLL_INTERVAL_MS / 1000}s)`);
    // Run immediately on start, then on interval.
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
    this.timer.unref(); // don't keep process alive by itself
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Schedule a one-shot task to run at a specific time (or immediately).
   * Returns the task id.
   */
  scheduleOnce(input: string, scheduledFor?: Date, metadata?: Record<string, unknown>): string {
    const id = randomUUID();
    const now = Date.now();
    taskStore.create({
      id,
      agentId: this.agentId,
      state: "queued",
      messages: [{ role: "user", content: [{ type: "text", text: input }] }],
      createdAt: now,
      updatedAt: now,
      scheduledFor: scheduledFor?.getTime(),
      metadata,
    });
    fireHook("task:queued", { taskId: id, input, scheduledFor: scheduledFor?.getTime(), metadata });
    return id;
  }

  /**
   * Schedule a recurring task using a cron expression.
   * Returns the id of the first queued task.
   */
  scheduleCron(input: string, cronExpr: string, metadata?: Record<string, unknown>): string {
    const first = nextRun(cronExpr, new Date());
    const id = randomUUID();
    const now = Date.now();
    taskStore.create({
      id,
      agentId: this.agentId,
      state: "queued",
      messages: [{ role: "user", content: [{ type: "text", text: input }] }],
      createdAt: now,
      updatedAt: now,
      cronExpr,
      scheduledFor: first?.getTime() ?? now,
      metadata,
    });
    fireHook("task:queued", { taskId: id, input, cronExpr, scheduledFor: first?.getTime() ?? now, metadata });
    return id;
  }

  /**
   * Start a goal-driven task that keeps re-running until the condition is met.
   * Returns the task id.
   */
  scheduleGoal(
    input: string,
    goalCondition: string,
    metadata?: Record<string, unknown>,
  ): string {
    const id = randomUUID();
    const now = Date.now();
    taskStore.create({
      id,
      agentId: this.agentId,
      state: "queued",
      messages: [{ role: "user", content: [{ type: "text", text: input }] }],
      createdAt: now,
      updatedAt: now,
      goalCondition,
      metadata,
    });
    fireHook("task:queued", { taskId: id, input, goalCondition, metadata });
    return id;
  }

  private async poll(): Promise<void> {
    if (this.inFlight.size >= MAX_CONCURRENT) return;

    const due = taskStore.listDue().filter((t) => !this.inFlight.has(t.id));
    const slots = MAX_CONCURRENT - this.inFlight.size;
    const batch = due.slice(0, slots);

    for (const task of batch) {
      this.inFlight.add(task.id);
      void this.runTask(task).finally(() => this.inFlight.delete(task.id));
    }
  }

  private async runTask(task: PersistedTask): Promise<void> {
    const input = extractInput(task.messages);
    if (!input) {
      taskStore.update(task.id, { state: "failed", outputText: "No input text found." });
      fireHook("task:failed", { taskId: task.id, task, error: "No input text found." });
      this.onTaskComplete?.(task, "", "No input text found.");
      return;
    }

    taskStore.update(task.id, { state: "working" });
    fireHook("task:started", { taskId: task.id, task, input });

    let output = "";
    try {
      for await (const chunk of runHeadlessAgent({
        input,
        threadId: task.id,
      })) {
        output += chunk;
      }

      taskStore.update(task.id, { state: "completed", outputText: output });

      // Goal-driven: check if condition is met; if not, re-queue.
      if (task.goalCondition) {
        const met = await isGoalMet(task.goalCondition, output);
        if (!met) {
          const retryAt = Date.now() + GOAL_RETRY_MINUTES * 60_000;
          const nextId = randomUUID();
          const now = Date.now();
          taskStore.create({
            id: nextId,
            agentId: task.agentId,
            state: "queued",
            messages: task.messages,
            createdAt: now,
            updatedAt: now,
            goalCondition: task.goalCondition,
            scheduledFor: retryAt,
            metadata: task.metadata,
          });
          globalBroadcaster.broadcastAgentEvent(task.id, {
            type: "status",
            message: `Goal not yet met. Retrying in ${GOAL_RETRY_MINUTES} min (task ${nextId}).`,
          } as never);
        } else {
          globalBroadcaster.broadcastAgentEvent(task.id, {
            type: "status",
            message: `Goal achieved: ${task.goalCondition}`,
          } as never);
          fireHook("task:complete", { taskId: task.id, task, output });
          this.onTaskComplete?.(task, output);
        }
        return;
      }

      // Recurring: queue the next occurrence.
      if (task.cronExpr) {
        const next = nextRun(task.cronExpr, new Date());
        if (next) {
          const nextId = randomUUID();
          const now = Date.now();
          taskStore.create({
            id: nextId,
            agentId: task.agentId,
            state: "queued",
            messages: task.messages,
            createdAt: now,
            updatedAt: now,
            cronExpr: task.cronExpr,
            scheduledFor: next.getTime(),
            metadata: task.metadata,
          });
        }
      }

      fireHook("task:complete", { taskId: task.id, task, output });
      this.onTaskComplete?.(task, output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      taskStore.update(task.id, { state: "failed", outputText: msg });
      fireHook("task:failed", { taskId: task.id, task, error: msg });
      this.onTaskComplete?.(task, "", msg);
    }
  }
}

function extractInput(messages: TaskMessage[]): string {
  for (const msg of [...messages].reverse()) {
    if (msg.role === "user") {
      const part = msg.content.find((c) => c.type === "text");
      if (part?.text) return part.text;
    }
  }
  return "";
}
