import { createHash } from "crypto";
import { streamOllama } from "../ollama/client.js";
import type { TaskKind, ExecutionLane, TaskPath, TaskRoute } from "./types.js";

const VALID_KINDS   = new Set<TaskKind>(["answer_only","inspect_only","single_file_edit","multi_file_edit","debug","research","project_phase"]);
const VALID_LANES   = new Set<ExecutionLane>(["foreground_sync","background_async","cheap_triage"]);
const VALID_PATHS   = new Set<TaskPath>(["direct_agent_path","tool_or_single_worker_path","parallel_multi_worker_path","research_then_plan_path","background_or_batch_path"]);

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";
const ROUTER_TIMEOUT_MS = 2_000;
const CACHE_MAX = 50;

export interface RouteResult extends TaskRoute {
  confidence: number;
}

// LRU cache keyed by SHA-256 of input text (insertion-order eviction at max 50 entries)
const routeCache = new Map<string, RouteResult>();

const ROUTER_SYSTEM_PROMPT = `You are a task classifier. Given a user request, output ONLY valid JSON with this shape:
{"kind":"<kind>","lane":"<lane>","path":"<path>","confidence":<0.0-1.0>}

kind options: answer_only | inspect_only | single_file_edit | multi_file_edit | debug | research | project_phase
lane options: foreground_sync | background_async | cheap_triage
path options: direct_agent_path | tool_or_single_worker_path | parallel_multi_worker_path | research_then_plan_path | background_or_batch_path

Output ONLY the JSON object, no explanation.`;

const FALLBACK_ROUTE: RouteResult = {
  kind: "multi_file_edit",
  lane: "foreground_sync",
  path: "parallel_multi_worker_path",
  requiresResearch: true,
  canParallelize: true,
  usesCheapTriage: false,
  confidence: 0.5,
};

function cacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function deriveRouteFields(kind: TaskKind): Pick<TaskRoute, "requiresResearch" | "canParallelize" | "usesCheapTriage"> {
  switch (kind) {
    case "answer_only":
    case "inspect_only":
      return { requiresResearch: false, canParallelize: false, usesCheapTriage: true };
    case "single_file_edit":
    case "debug":
      return { requiresResearch: false, canParallelize: false, usesCheapTriage: false };
    case "multi_file_edit":
    case "research":
      return { requiresResearch: true, canParallelize: true, usesCheapTriage: false };
    case "project_phase":
      return { requiresResearch: true, canParallelize: true, usesCheapTriage: false };
  }
}

async function callRouterLLM(task: string): Promise<RouteResult> {
  let rawOutput = "";

  const execution = new Promise<void>((resolve, reject) => {
    streamOllama({
      baseUrl: OLLAMA_BASE_URL,
      model: MODEL_NAME,
      systemPrompt: ROUTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Task: ${task.slice(0, 500)}` }],
      onThink: () => {},
      onResponse: (chunk) => { rawOutput += chunk; },
      onComplete: () => resolve(),
      onError: reject,
    });
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Router timeout")), ROUTER_TIMEOUT_MS)
  );

  await Promise.race([execution, timeoutPromise]);

  // Extract JSON from output (model may wrap it in markdown)
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in router output");

  const parsed = JSON.parse(jsonMatch[0]);

  const kind: TaskKind = VALID_KINDS.has(parsed.kind) ? parsed.kind : FALLBACK_ROUTE.kind;
  const lane: ExecutionLane = VALID_LANES.has(parsed.lane) ? parsed.lane : FALLBACK_ROUTE.lane;
  const routePath: TaskPath = VALID_PATHS.has(parsed.path) ? parsed.path : FALLBACK_ROUTE.path;
  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  const derived = deriveRouteFields(kind);

  return {
    kind,
    lane,
    path: routePath,
    confidence,
    ...derived,
  };
}

export async function semanticRoute(task: string): Promise<RouteResult> {
  const key = cacheKey(task);
  const cached = routeCache.get(key);
  if (cached) {
    // Refresh insertion order (LRU)
    routeCache.delete(key);
    routeCache.set(key, cached);
    return cached;
  }

  let result: RouteResult;
  try {
    result = await callRouterLLM(task);
  } catch {
    result = { ...FALLBACK_ROUTE };
  }

  // Evict oldest entry if at capacity
  if (routeCache.size >= CACHE_MAX) {
    const oldest = routeCache.keys().next().value;
    if (oldest) routeCache.delete(oldest);
  }
  routeCache.set(key, result);

  if (process.env.DEBUG === "1") {
    console.error(`[semanticRouter] kind=${result.kind} conf=${result.confidence.toFixed(2)} lane=${result.lane}`);
  }

  return result;
}
