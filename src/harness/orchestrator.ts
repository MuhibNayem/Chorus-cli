import { semanticRoute, type RouteResult } from "./semanticRouter.js";
import { runWorkerPipeline, type WorkerEngineResult, type WorkerEngineOptions } from "./workerEngine.js";
import { Annotation, StateGraph, MemorySaver, START, END } from "@langchain/langgraph";
import { streamOllama } from "../ollama/client.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";

export interface OrchestratorOptions {
  task: string;
  threadId?: string;
  onProgress?: (role: string, chunk: string) => void;
}

export interface OrchestratorResult extends WorkerEngineResult {
  route: RouteResult;
  strategy: "direct" | "single_file" | "full_pipeline";
}

// Direct agent for simple / low-confidence tasks (answer_only, inspect_only, low confidence)
async function runDirectAgent(task: string, onProgress?: (chunk: string) => void): Promise<string> {
  let output = "";
  await new Promise<void>((resolve, reject) => {
    streamOllama({
      baseUrl: OLLAMA_BASE_URL,
      model: MODEL_NAME,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: task }],
      onThink: () => {},
      onResponse: (chunk) => {
        output += chunk;
        onProgress?.(chunk);
      },
      onComplete: () => resolve(),
      onError: reject,
    });
  });
  return output;
}

export async function orchestrate(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const { task, threadId, onProgress } = options;

  const route = await semanticRoute(task);

  // Low-confidence or trivial tasks → direct single-agent path
  if (route.confidence < 0.6 || route.kind === "answer_only" || route.kind === "inspect_only") {
    const output = await runDirectAgent(task, onProgress ? (c) => onProgress("agent", c) : undefined);
    return {
      route,
      strategy: "direct",
      threadId: threadId ?? `direct-${Date.now()}`,
      finalSummary: output,
      codeChanges: "",
      reviewNotes: "",
      findings: { agent: output },
    };
  }

  // High-confidence single_file_edit → skip researcher, go straight to coder + reviewer
  if (route.kind === "single_file_edit" && route.confidence >= 0.8) {
    const result = await runWorkerPipeline({
      task,
      threadId,
      onProgress,
    });
    return { route, strategy: "single_file", ...result };
  }

  // High-confidence debug → add dedicated debug context
  if (route.kind === "debug" && route.confidence >= 0.8) {
    const debugTask = `DEBUG MODE: ${task}\n\nFocus on identifying the root cause before proposing a fix. Use systematic elimination.`;
    const result = await runWorkerPipeline({
      task: debugTask,
      threadId,
      onProgress,
    });
    return { route, strategy: "full_pipeline", ...result };
  }

  // Default: full multi-worker pipeline
  const result = await runWorkerPipeline({ task, threadId, onProgress });
  return { route, strategy: "full_pipeline", ...result };
}
