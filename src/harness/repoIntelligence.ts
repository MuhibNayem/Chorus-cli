import * as fs from "fs";
import * as path from "path";
import type { RepoIntelligence } from "./types.js";

function detectPackageManager(cwd: string): string | undefined {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "cargo";
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "go";
  return undefined;
}

function detectLanguages(cwd: string): string[] {
  const langs: string[] = [];
  const checks: Array<[string, string]> = [
    ["tsconfig.json", "TypeScript"],
    ["package.json", "JavaScript"],
    ["Cargo.toml", "Rust"],
    ["go.mod", "Go"],
    ["pyproject.toml", "Python"],
    ["requirements.txt", "Python"],
  ];
  for (const [file, lang] of checks) {
    if (fs.existsSync(path.join(cwd, file)) && !langs.includes(lang)) {
      langs.push(lang);
    }
  }
  return langs;
}

function detectImportantFiles(cwd: string): string[] {
  const candidates = [
    "README.md", "CLAUDE.md", "AGENTS.md", "package.json", "tsconfig.json",
    "Cargo.toml", "go.mod", "pyproject.toml", ".env.example",
  ];
  return candidates.filter((f) => fs.existsSync(path.join(cwd, f)));
}

function detectCommands(cwd: string): string[] {
  const cmds: string[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")) as { scripts?: Record<string, string> };
    if (pkg.scripts) {
      for (const key of Object.keys(pkg.scripts).slice(0, 8)) {
        cmds.push(`npm run ${key}`);
      }
    }
  } catch { /* no package.json */ }
  return cmds;
}

function detectTestSignals(cwd: string): string[] {
  const signals: string[] = [];
  if (fs.existsSync(path.join(cwd, "vitest.config.ts")) || fs.existsSync(path.join(cwd, "vitest.config.js"))) {
    signals.push("vitest");
  }
  if (fs.existsSync(path.join(cwd, "jest.config.js")) || fs.existsSync(path.join(cwd, "jest.config.ts"))) {
    signals.push("jest");
  }
  return signals;
}

function countSourceFiles(cwd: string): number {
  let count = 0;
  function walk(dir: string, depth: number): void {
    if (depth > 4) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
        else if (/\.(ts|tsx|js|jsx|py|rs|go)$/.test(entry.name)) count++;
      }
    } catch { /* ignore permission errors */ }
  }
  walk(cwd, 0);
  return count;
}

export function loadRepoIntelligence(): RepoIntelligence {
  const cwd = process.cwd();
  const packageManager = detectPackageManager(cwd);
  const languages = detectLanguages(cwd);
  const importantFiles = detectImportantFiles(cwd);
  const commands = detectCommands(cwd);
  const testSignals = detectTestSignals(cwd);
  const sourceFiles = countSourceFiles(cwd);

  const langStr = languages.length > 0 ? languages.join("/") : "unknown";
  const summary = `${langStr} project with ${sourceFiles} source files.${packageManager ? ` Package manager: ${packageManager}.` : ""}`;

  return {
    version: `v1-${Date.now()}`,
    summary,
    packageManager,
    languages,
    importantFiles,
    commands,
    testSignals,
    generatedAt: Date.now(),
  };
}
