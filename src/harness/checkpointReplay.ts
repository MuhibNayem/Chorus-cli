import { checkpointer, buildWorkerGraph, type WorkerGraphState } from "./workerGraph.js";

export interface CheckpointInfo {
  checkpointId: string;
  threadId: string;
  step: number;
  ts: string;
}

export async function listCheckpoints(threadId: string): Promise<CheckpointInfo[]> {
  const results: CheckpointInfo[] = [];
  const config = { configurable: { thread_id: threadId } };
  try {
    for await (const item of checkpointer.list(config)) {
      results.push({
        checkpointId: item.checkpoint.id,
        threadId,
        step: item.metadata?.step ?? -1,
        ts: item.checkpoint.ts,
      });
    }
  } catch {
    // Checkpoint store may be empty for this thread
  }
  return results;
}

export async function replayFromCheckpoint(
  threadId: string,
  checkpointId: string,
  onProgress?: (role: string, chunk: string) => void
): Promise<WorkerGraphState | null> {
  const graph = buildWorkerGraph({ onProgress });

  const config = {
    configurable: {
      thread_id: threadId,
      checkpoint_id: checkpointId,
    },
  };

  try {
    const stateSnapshot = await graph.getState(config);
    if (!stateSnapshot) return null;

    return stateSnapshot.values as WorkerGraphState;
  } catch (err) {
    console.error("[checkpointReplay] Replay failed:", err);
    return null;
  }
}
