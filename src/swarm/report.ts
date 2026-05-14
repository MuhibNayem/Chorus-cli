/**
 * Swarm observability report.
 *
 * Reads a trace JSONL file written by SwarmTracer and produces a structured
 * SwarmReport with per-agent metrics, a text DAG visualization, and a
 * classified failure summary.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SwarmEvent } from "./types.js";
import type { AgentMetrics } from "./types.js";
import { formatCost } from "../llm/pricing.js";

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

export interface AgentReport {
  name: string;
  metrics: AgentMetrics;
  status: "done" | "failed" | "circuit-broken";
  failureReason?: string;
}

export interface FailureEvent {
  type: "circuit-break" | "validation-fail" | "artifact-missing" | "worktree-error" | "tool-error" | "error";
  agent: string;
  reason: string;
}

export interface SwarmReport {
  swarmId: string;
  status: "done" | "failed";
  durationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  agents: AgentReport[];
  waves: string[][];
  failures: FailureEvent[];
  dagText: string;
  costTable: string;
}

type TracedEvent = SwarmEvent & { ts: number };

export function buildSwarmReport(swarmId: string): SwarmReport | null {
  const tracePath = path.join(chorusHome(), "swarm-traces", `${swarmId}.jsonl`);
  if (!fs.existsSync(tracePath)) return null;

  const lines = fs.readFileSync(tracePath, "utf-8").split("\n").filter(Boolean);
  const events: TracedEvent[] = lines
    .map((line) => {
      try {
        return JSON.parse(line) as TracedEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is TracedEvent => e !== null);

  // ─── Collect per-agent metrics ──────────────────────────────────────────────
  const agentMetrics = new Map<string, AgentMetrics>();
  const agentStatus = new Map<string, AgentReport["status"]>();
  const agentFailureReason = new Map<string, string>();

  // ─── Collect waves ──────────────────────────────────────────────────────────
  const waves: string[][] = [];

  // ─── Collect failures ───────────────────────────────────────────────────────
  const failures: FailureEvent[] = [];

  // ─── Swarm-level totals ─────────────────────────────────────────────────────
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let swarmDurationMs = 0;
  let swarmStatus: "done" | "failed" = "failed";
  let firstTs = events[0]?.ts ?? 0;
  let lastTs = events[events.length - 1]?.ts ?? 0;

  for (const event of events) {
    switch (event.type) {
      case "wave-start":
        waves.push(event.agents);
        break;

      case "agent-done":
        agentMetrics.set(event.agent, event.metrics);
        if (!agentStatus.has(event.agent)) {
          agentStatus.set(event.agent, "done");
        }
        break;

      case "circuit-break":
        agentStatus.set(event.agent, "circuit-broken");
        agentFailureReason.set(event.agent, event.reason);
        failures.push({ type: "circuit-break", agent: event.agent, reason: event.reason });
        break;

      case "validation-fail":
        agentStatus.set(event.agent, "failed");
        agentFailureReason.set(event.agent, event.reason);
        failures.push({ type: "validation-fail", agent: event.agent, reason: event.reason });
        break;

      case "artifact-missing":
        failures.push({
          type: "artifact-missing",
          agent: event.agent,
          reason: `Missing artifact: ${event.key}`,
        });
        break;

      case "worktree-error":
        failures.push({ type: "worktree-error", agent: event.agent, reason: event.reason });
        break;

      case "swarm-done":
        totalInputTokens = event.totalInputTokens;
        totalOutputTokens = event.totalOutputTokens;
        totalCostUsd = event.totalCostUsd;
        swarmDurationMs = event.durationMs;
        swarmStatus = "done";
        break;
    }
  }

  // Fallback duration from timestamps when swarm-done durationMs is absent
  if (swarmDurationMs === 0 && lastTs > firstTs) {
    swarmDurationMs = lastTs - firstTs;
  }

  // ─── Build agent list from start events ─────────────────────────────────────
  const agentNames: string[] = [];
  for (const event of events) {
    if (event.type === "agent-start" && !agentNames.includes(event.agent)) {
      agentNames.push(event.agent);
    }
  }

  // Reconstruct totals from per-agent metrics when swarm-done has zeros
  // (e.g. from the handoff executor which uses a different accumulation path)
  if (totalInputTokens === 0 && agentMetrics.size > 0) {
    for (const m of agentMetrics.values()) {
      totalInputTokens += m.inputTokens;
      totalOutputTokens += m.outputTokens;
      totalCostUsd += m.costUsd;
    }
  }

  const agents: AgentReport[] = agentNames.map((name) => ({
    name,
    metrics: agentMetrics.get(name) ?? {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
      rounds: 0,
      toolCalls: 0,
    },
    status: agentStatus.get(name) ?? "failed",
    failureReason: agentFailureReason.get(name),
  }));

  // ─── DAG text visualization ─────────────────────────────────────────────────
  const dagText = buildDagText(waves, agents);

  // ─── Cost table ─────────────────────────────────────────────────────────────
  const costTable = buildCostTable(agents, totalInputTokens, totalOutputTokens, totalCostUsd);

  return {
    swarmId,
    status: swarmStatus,
    durationMs: swarmDurationMs,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    agents,
    waves,
    failures,
    dagText,
    costTable,
  };
}

function buildDagText(waves: string[][], agents: AgentReport[]): string {
  if (waves.length === 0) return "(no wave data)";

  const statusIcon = (name: string): string => {
    const agent = agents.find((a) => a.name === name);
    if (!agent) return "?";
    switch (agent.status) {
      case "done": return "✓";
      case "failed": return "✗";
      case "circuit-broken": return "⚡";
    }
  };

  const lines: string[] = [];
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    lines.push(`Wave ${i}: [${wave.map((n) => `${statusIcon(n)} ${n}`).join("  |  ")}]`);
    if (i < waves.length - 1) {
      lines.push("         │");
      lines.push("         ▼");
    }
  }
  return lines.join("\n");
}

function buildCostTable(
  agents: AgentReport[],
  totalIn: number,
  totalOut: number,
  totalCost: number,
): string {
  const COL = { name: 20, status: 10, in: 10, out: 10, cost: 10, time: 10, tools: 6 };
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  const header =
    pad("Agent", COL.name) +
    pad("Status", COL.status) +
    pad("In Tok", COL.in) +
    pad("Out Tok", COL.out) +
    pad("Cost", COL.cost) +
    pad("Time(s)", COL.time) +
    pad("Tools", COL.tools);
  const sep = "-".repeat(header.length);

  const rows = agents.map((a) =>
    pad(a.name, COL.name) +
    pad(a.status, COL.status) +
    pad(String(a.metrics.inputTokens), COL.in) +
    pad(String(a.metrics.outputTokens), COL.out) +
    pad(formatCost(a.metrics.costUsd), COL.cost) +
    pad((a.metrics.durationMs / 1000).toFixed(1), COL.time) +
    pad(String(a.metrics.toolCalls), COL.tools),
  );

  const totals =
    pad("TOTAL", COL.name) +
    pad("", COL.status) +
    pad(String(totalIn), COL.in) +
    pad(String(totalOut), COL.out) +
    pad(formatCost(totalCost), COL.cost);

  return [header, sep, ...rows, sep, totals].join("\n");
}

export function formatSwarmReport(report: SwarmReport): string {
  const lines: string[] = [
    `Swarm Report: ${report.swarmId}`,
    `Status: ${report.status.toUpperCase()}  |  Duration: ${(report.durationMs / 1000).toFixed(1)}s  |  Total cost: ${formatCost(report.totalCostUsd)}`,
    "",
    "── DAG Execution Graph ──────────────────────────────────────────────",
    report.dagText,
    "",
    "── Per-Agent Metrics ────────────────────────────────────────────────",
    report.costTable,
  ];

  if (report.failures.length > 0) {
    lines.push("");
    lines.push("── Failures ─────────────────────────────────────────────────────────");
    for (const f of report.failures) {
      lines.push(`  [${f.type}] ${f.agent}: ${f.reason}`);
    }
  }

  return lines.join("\n");
}

export function listSwarmTraces(): string[] {
  const dir = path.join(chorusHome(), "swarm-traces");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""))
    .sort();
}
