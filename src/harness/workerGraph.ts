import { Annotation, StateGraph, MemorySaver, START, END } from "@langchain/langgraph";
import { streamOllama } from "../ollama/client.js";
import { PLANNER_PROMPT, BUILDER_PROMPT } from "../prompts/system.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";
const WORKER_TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT_MS ?? "30000", 10);

export type WorkerRole = "researcher" | "planner" | "coder" | "reviewer" | "tester" | "summarizer";

export const WorkerStateAnnotation = Annotation.Root({
  task: Annotation<string>(),
  findings: Annotation<Partial<Record<WorkerRole, string>>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  plan: Annotation<string>({
    reducer: (_x: string, y: string) => y,
    default: () => "",
  }),
  codeChanges: Annotation<string>({
    reducer: (_x: string, y: string) => y,
    default: () => "",
  }),
  reviewNotes: Annotation<string>({
    reducer: (_x: string, y: string) => y,
    default: () => "",
  }),
  finalSummary: Annotation<string>({
    reducer: (_x: string, y: string) => y,
    default: () => "",
  }),
});

export type WorkerGraphState = typeof WorkerStateAnnotation.State;

export interface WorkerNodeConfig {
  onProgress?: (role: WorkerRole, chunk: string) => void;
}

async function callWorker(
  role: WorkerRole,
  systemPrompt: string,
  userMessage: string,
  onProgress?: (chunk: string) => void
): Promise<string> {
  let output = "";

  const execution = new Promise<string>((resolve, reject) => {
    streamOllama({
      baseUrl: OLLAMA_BASE_URL,
      model: MODEL_NAME,
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      onThink: () => {},
      onResponse: (chunk) => {
        output += chunk;
        onProgress?.(chunk);
      },
      onComplete: () => resolve(output),
      onError: reject,
    });
  });

  const timeout = new Promise<string>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Worker ${role} timed out after ${WORKER_TIMEOUT_MS}ms`)),
      WORKER_TIMEOUT_MS
    )
  );

  return Promise.race([execution, timeout]).catch((err: Error) => {
    console.error(`[workerGraph] ${role} error:`, err.message);
    return `[${role} partial result — timed out or errored]`;
  });
}

function makeWorkerNode(role: WorkerRole, config: WorkerNodeConfig) {
  const onProgress = config.onProgress;
  return async (state: WorkerGraphState): Promise<Partial<WorkerGraphState>> => {
    const notify = onProgress ? (chunk: string) => onProgress(role, chunk) : undefined;

    switch (role) {
      case "researcher": {
        const result = await callWorker(
          role,
          PLANNER_PROMPT,
          `Research the following task. Identify relevant context, existing patterns, and key constraints.\n\nTask: ${state.task}\n\nProvide a concise research summary (3-5 paragraphs max).`,
          notify
        );
        return { findings: { researcher: result } };
      }

      case "planner": {
        // Planner runs in parallel with researcher, so researcher findings are not yet available.
        // It receives only the raw task and produces an initial plan; coder merges both.
        const result = await callWorker(
          role,
          PLANNER_PROMPT,
          `Create a step-by-step implementation plan based solely on the task description.\n\nTask: ${state.task}\n\nProvide a numbered implementation plan.`,
          notify
        );
        return { findings: { planner: result }, plan: result };
      }

      case "coder": {
        // Coder runs after both researcher and planner, so it can merge their outputs.
        const researchContext = state.findings.researcher ? `\n\nResearch findings:\n${state.findings.researcher}` : "";
        const result = await callWorker(
          role,
          BUILDER_PROMPT,
          `Implement the following plan.\n\nTask: ${state.task}\n\nPlan:\n${state.plan}${researchContext}\n\nProvide the implementation with code changes.`,
          notify
        );
        return { findings: { coder: result }, codeChanges: result };
      }

      case "reviewer": {
        const result = await callWorker(
          role,
          BUILDER_PROMPT,
          `Review the following code changes for correctness, style, and edge cases.\n\nTask: ${state.task}\n\nCode changes:\n${state.codeChanges}\n\nProvide a code review with specific feedback.`,
          notify
        );
        return { findings: { reviewer: result }, reviewNotes: result };
      }

      case "tester": {
        const result = await callWorker(
          role,
          BUILDER_PROMPT,
          `Write tests for the following code changes.\n\nTask: ${state.task}\n\nCode changes:\n${state.codeChanges}\n\nProvide test cases covering the main scenarios and edge cases.`,
          notify
        );
        return { findings: { tester: result } };
      }

      case "summarizer": {
        const result = await callWorker(
          role,
          PLANNER_PROMPT,
          `Summarize the completed work.\n\nTask: ${state.task}\n\nCode changes:\n${state.codeChanges}\n\nReview notes:\n${state.reviewNotes}\n\nProvide a concise summary of what was accomplished and any remaining considerations.`,
          notify
        );
        return { findings: { summarizer: result }, finalSummary: result };
      }
    }
  };
}

// Shared MemorySaver across all compiled graph instances for checkpoint persistence
export const checkpointer = new MemorySaver();

export function buildWorkerGraph(config: WorkerNodeConfig = {}) {
  // Add nodes first so TypeScript can infer valid node names for edges
  const graph = new StateGraph(WorkerStateAnnotation)
    .addNode("researcher", makeWorkerNode("researcher", config))
    .addNode("planner",    makeWorkerNode("planner",    config))
    .addNode("coder",      makeWorkerNode("coder",      config))
    .addNode("reviewer",   makeWorkerNode("reviewer",   config))
    .addNode("tester",     makeWorkerNode("tester",     config))
    .addNode("summarizer", makeWorkerNode("summarizer", config))
    // Parallel: researcher + planner fire from START
    .addEdge(START, "researcher")
    .addEdge(START, "planner")
    // Sequential: coder waits for both researcher + planner
    .addEdge("researcher", "coder")
    .addEdge("planner",    "coder")
    // Parallel: reviewer + tester fire after coder
    .addEdge("coder", "reviewer")
    .addEdge("coder", "tester")
    // summarizer waits for both reviewer + tester
    .addEdge("reviewer",   "summarizer")
    .addEdge("tester",     "summarizer")
    .addEdge("summarizer", END);

  return graph.compile({ checkpointer });
}
