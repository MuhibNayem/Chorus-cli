import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

function nsDir(namespace: string): string {
  const dir = path.join(chorusHome(), "memory", namespace);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keyPath(namespace: string, key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(nsDir(namespace), safeKey);
}

export class FileMemoryStore {
  async get(namespace: string, key: string): Promise<string | null> {
    try {
      return fs.readFileSync(keyPath(namespace, key), "utf-8");
    } catch {
      return null;
    }
  }

  async put(namespace: string, key: string, value: string): Promise<void> {
    const p = keyPath(namespace, key);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, value, "utf-8");
    fs.renameSync(tmp, p);
  }

  async list(namespace: string): Promise<string[]> {
    try {
      return fs.readdirSync(nsDir(namespace)).filter((f) => !f.endsWith(".tmp"));
    } catch {
      return [];
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    try {
      fs.unlinkSync(keyPath(namespace, key));
    } catch {
      // ignore if not found
    }
  }

  async search(namespace: string, query: string): Promise<Array<{ key: string; value: string }>> {
    const keys = await this.list(namespace);
    const q = query.toLowerCase();
    const results: Array<{ key: string; value: string }> = [];
    for (const key of keys) {
      const value = await this.get(namespace, key);
      if (value !== null && (key.toLowerCase().includes(q) || value.toLowerCase().includes(q))) {
        results.push({ key, value });
      }
    }
    return results;
  }
}
