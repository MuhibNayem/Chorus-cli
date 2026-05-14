import * as fs from "fs";
import * as path from "path";
import { getSettingsPath } from "../settings/storage.js";
import type { Checkpoint, Checkpointer, CheckpointState } from "./types.js";

function getCheckpointRoot(): string {
  const root = path.join(path.dirname(getSettingsPath()), "checkpoints");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function threadDir(threadId: string): string {
  return path.join(getCheckpointRoot(), threadId);
}

function checkpointFile(threadId: string, round: number): string {
  return path.join(threadDir(threadId), `${String(round).padStart(6, "0")}.json`);
}

function atomicWriteJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export class JsonFileCheckpointer implements Checkpointer {
  async save(threadId: string, state: CheckpointState): Promise<void> {
    const checkpoint: Checkpoint = {
      threadId,
      round: state.round,
      messages: state.messages,
      createdAt: Date.now(),
      waitingForHitl: state.waitingForHitl,
    };
    atomicWriteJson(checkpointFile(threadId, state.round), checkpoint);
  }

  async load(threadId: string): Promise<Checkpoint | null> {
    const items = await this.list(threadId);
    return items.length > 0 ? items[items.length - 1] : null;
  }

  async loadAt(threadId: string, round: number): Promise<Checkpoint | null> {
    const filePath = checkpointFile(threadId, round);
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Checkpoint;
    } catch {
      return null;
    }
  }

  async list(threadId: string): Promise<Checkpoint[]> {
    try {
      const dir = threadDir(threadId);
      const files = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort();
      return files.map((name) =>
        JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as Checkpoint,
      );
    } catch {
      return [];
    }
  }

  async fork(threadId: string, round: number, newThreadId: string): Promise<void> {
    const checkpoint = await this.loadAt(threadId, round);
    if (!checkpoint) return;
    await this.save(newThreadId, {
      messages: checkpoint.messages,
      round: checkpoint.round,
      waitingForHitl: checkpoint.waitingForHitl,
    });
  }

  async delete(threadId: string): Promise<void> {
    fs.rmSync(threadDir(threadId), { recursive: true, force: true });
  }
}
