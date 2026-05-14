/**
 * Swarm-level checkpoint persistence.
 *
 * Records which waves have completed and what artifacts they produced.
 * Stored separately from per-agent loop checkpoints; lives at:
 *   ${CHORUS_HOME_DIR}/.chorus/swarm-checkpoints/{swarmId}.json
 *
 * Lifecycle:
 *   - Created when the first wave of a graph swarm completes.
 *   - Updated after each subsequent wave.
 *   - Deleted when the swarm reaches swarm-done (full success).
 *   - Left on disk if the swarm crashes or is interrupted, enabling resume.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface SwarmCheckpointData {
  swarmId: string;
  /** Number of waves that have fully completed (0-based count). */
  completedWaves: number;
  /** All artifacts accumulated from completed waves. */
  artifacts: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

function checkpointDir(): string {
  return path.join(chorusHome(), "swarm-checkpoints");
}

function checkpointPath(swarmId: string): string {
  return path.join(checkpointDir(), `${swarmId}.json`);
}

function atomicWrite(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export class SwarmCheckpointer {
  /**
   * Save (or update) the checkpoint for a swarm.
   * @param swarmId   Unique identifier for this swarm run.
   * @param completedWaves  Number of waves fully completed so far.
   * @param artifacts All artifacts accumulated from completed waves.
   */
  save(
    swarmId: string,
    completedWaves: number,
    artifacts: Record<string, string>,
  ): void {
    try {
      const existing = this.load(swarmId);
      const data: SwarmCheckpointData = {
        swarmId,
        completedWaves,
        artifacts: { ...artifacts },
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      atomicWrite(checkpointPath(swarmId), data);
    } catch {
      // Never crash on checkpoint write failure
    }
  }

  /**
   * Load an existing checkpoint. Returns null if none exists or it is corrupt.
   */
  load(swarmId: string): SwarmCheckpointData | null {
    try {
      const raw = fs.readFileSync(checkpointPath(swarmId), "utf-8");
      const data = JSON.parse(raw) as SwarmCheckpointData;
      if (
        typeof data.swarmId !== "string" ||
        typeof data.completedWaves !== "number" ||
        typeof data.artifacts !== "object"
      ) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Delete the checkpoint for a completed (or abandoned) swarm.
   * Silent no-op if the checkpoint does not exist.
   */
  delete(swarmId: string): void {
    try {
      fs.unlinkSync(checkpointPath(swarmId));
    } catch {
      // Ignore
    }
  }

  /**
   * List all checkpoint summaries (for display / debugging).
   */
  list(): SwarmCheckpointData[] {
    try {
      const dir = checkpointDir();
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(
              fs.readFileSync(path.join(dir, f), "utf-8"),
            ) as SwarmCheckpointData;
          } catch {
            return null;
          }
        })
        .filter((d): d is SwarmCheckpointData => d !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }
}
