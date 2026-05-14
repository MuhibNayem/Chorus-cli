import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SwarmEvent } from "./types.js";

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

export class SwarmTracer {
  private readonly filePath: string;
  private readonly buf: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(swarmId: string) {
    const dir = path.join(chorusHome(), "swarm-traces");
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, `${swarmId}.jsonl`);
  }

  record(event: SwarmEvent): void {
    this.buf.push(JSON.stringify({ ts: Date.now(), ...event }));
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), 200);
    }
  }

  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buf.length === 0) return;
    const lines = this.buf.splice(0).join("\n") + "\n";
    try {
      fs.appendFileSync(this.filePath, lines, "utf8");
    } catch {
      /* never crash on trace write */
    }
  }
}
