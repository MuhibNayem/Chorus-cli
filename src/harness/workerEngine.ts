import { buildWorkerGraph, type WorkerGraphState } from "./workerGraph.js";
import { sessionManager } from "../session/manager.js";

export interface WorkerEngineOptions {
  task: string;
  threadId?: string;
  onProgress?: (role: string, chunk: string) => void;
}

export interface WorkerEngineResult {
  threadId: string;
  finalSummary: string;
  codeChanges: string;
  reviewNotes: string;
  findings: Partial<Record<string, string>>;
}

export async function runWorkerPipeline(options: WorkerEngineOptions): Promise<WorkerEngineResult> {
  const { task, onProgress } = options;
  const threadId = options.threadId ?? sessionManager.getCurrent()?.id ?? `worker-${Date.now()}`;

  const graph = buildWorkerGraph({ onProgress });

  const initialState = {
    task,
    findings: {},
    plan: "",
    codeChanges: "",
    reviewNotes: "",
    finalSummary: "",
  };

  const config = { configurable: { thread_id: threadId } };

  let finalState: WorkerGraphState = initialState as WorkerGraphState;

  for await (const event of await graph.stream(initialState as any, {
    ...config,
    streamMode: "values" as const,
  })) {
    finalState = event as WorkerGraphState;
  }

  return {
    threadId,
    finalSummary: finalState.finalSummary,
    codeChanges: finalState.codeChanges,
    reviewNotes: finalState.reviewNotes,
    findings: finalState.findings,
  };
}
