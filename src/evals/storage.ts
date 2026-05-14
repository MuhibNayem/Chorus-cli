/**
 * Eval storage — persists EvalSuites and EvalRuns to ~/.chorus/evals/.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { EvalSuite, EvalRun } from "./types.js";

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

function evalsDir(): string {
  const dir = path.join(chorusHome(), "evals");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function suitesDir(): string {
  const dir = path.join(evalsDir(), "suites");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runsDir(): string {
  const dir = path.join(evalsDir(), "runs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Suite storage ────────────────────────────────────────────────────────────

export function saveEvalSuite(suite: EvalSuite): void {
  const p = path.join(suitesDir(), `${suite.name}.json`);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(suite, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

export function loadEvalSuite(name: string): EvalSuite | null {
  const p = path.join(suitesDir(), `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as EvalSuite;
  } catch {
    return null;
  }
}

export function listEvalSuites(): string[] {
  try {
    return fs
      .readdirSync(suitesDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export function deleteEvalSuite(name: string): void {
  try {
    fs.unlinkSync(path.join(suitesDir(), `${name}.json`));
  } catch {
    // ignore
  }
}

// ─── Run storage ──────────────────────────────────────────────────────────────

export function saveEvalRun(run: EvalRun): void {
  const p = path.join(runsDir(), `${run.runId}.json`);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

export function loadEvalRun(runId: string): EvalRun | null {
  const p = path.join(runsDir(), `${runId}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as EvalRun;
  } catch {
    return null;
  }
}

export function listEvalRuns(suiteName?: string): EvalRun[] {
  try {
    const files = fs
      .readdirSync(runsDir())
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse(); // Most recent first

    return files
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(runsDir(), f), "utf-8"),
          ) as EvalRun;
        } catch {
          return null;
        }
      })
      .filter((r): r is EvalRun => r !== null)
      .filter((r) => !suiteName || r.suiteName === suiteName);
  } catch {
    return [];
  }
}
