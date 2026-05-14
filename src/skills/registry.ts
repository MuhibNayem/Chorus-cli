/**
 * Skill Registry — Central store for skills, patterns, metrics, and indexing.
 *
 * Coordinates:
 *   • Loading SKILL.md files from disk
 *   • In-memory semantic indexing
 *   • Performance metrics tracking
 *   • Hot-reload via file watcher
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  SkillDef,
  PatternDef,
  SkillMatch,
  SkillMetrics,
  ToolTrajectory,
  SerializedSkillMetrics,
} from "./types.js";
import { SkillIndex } from "./semanticIndex.js";
import { createEmbedder } from "./embedder.js";
import { loadSkillsFromDirs, saveSkillFile } from "./loader.js";

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

export class SkillRegistry {
  /** Human-authored skills (Layer 1). */
  private skills: Map<string, SkillDef> = new Map();
  /** Auto-synthesized patterns (Layer 2). */
  private patterns: Map<string, PatternDef> = new Map();
  /** Semantic search index. */
  private index: SkillIndex;
  /** Performance metrics. */
  private metrics: Map<string, SkillMetrics> = new Map();
  /** Directories to scan. */
  private skillDirs: string[];
  /** File watchers for hot-reload. */
  private watchers: fs.FSWatcher[] = [];
  /** Whether metrics have been modified since last save. */
  private metricsDirty = false;
  /** Initial/reload indexing work that callers must not race. */
  private ready: Promise<void>;

  constructor(skillDirs: string[]) {
    this.skillDirs = skillDirs;
    this.index = new SkillIndex(createEmbedder());
    this.loadMetrics();
    this.ready = this.reload();
    this.setupWatchers();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** Register a human-authored skill. */
  async registerSkill(skill: SkillDef): Promise<void> {
    await this.ready;
    this.skills.set(skill.name, skill);
    await this.index.indexSkill(skill, "skill");
  }

  /** Register an auto-synthesized pattern. */
  async registerPattern(pattern: PatternDef): Promise<void> {
    this.patterns.set(pattern.name, pattern);
    await this.ready;
    await this.index.indexSkill(pattern, "pattern");
  }

  /** Unregister by name. */
  unregister(name: string): void {
    this.skills.delete(name);
    this.patterns.delete(name);
    this.index.remove(name);
  }

  /** Reload all skills from disk. */
  async reload(): Promise<void> {
    const reloadPromise = this.performReload();
    this.ready = reloadPromise;
    await reloadPromise;
  }

  private async performReload(): Promise<void> {
    // Clear existing skills (but keep patterns)
    for (const name of this.skills.keys()) {
      this.index.remove(name);
    }
    this.skills.clear();

    const loaded = loadSkillsFromDirs(this.skillDirs);
    for (const skill of loaded) {
      this.skills.set(skill.name, skill);
      await this.index.indexSkill(skill, "skill");
    }
  }

  /** Clean up file watchers. */
  dispose(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    this.saveMetrics();
    this.index.saveToDisk();
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  getSkill(name: string): SkillDef | undefined {
    return this.skills.get(name);
  }

  getPattern(name: string): PatternDef | undefined {
    return this.patterns.get(name);
  }

  getAllSkills(): SkillDef[] {
    return Array.from(this.skills.values());
  }

  getAllPatterns(): PatternDef[] {
    return Array.from(this.patterns.values());
  }

  // ─── Semantic Search ────────────────────────────────────────────────────────

  /** Find relevant skills + patterns for a query. */
  async findRelevant(query: string, topK = 20, minScore = 0.0): Promise<SkillMatch[]> {
    await this.ready;
    const results = await this.index.search(query, topK, minScore);

    // Resolve names to actual skill/pattern objects
    return results
      .map((r) => {
        const skill = this.skills.get(r.skill.name);
        const pattern = this.patterns.get(r.skill.name);
        const resolved = skill ?? pattern;
        if (!resolved) return null;
        return {
          skill: resolved,
          score: r.score,
          kind: r.kind,
        };
      })
      .filter((r): r is SkillMatch => r !== null);
  }

  /** Find skills by tag prefix. */
  findByTag(tagPrefix: string): SkillDef[] {
    const names = this.index.searchByTag(tagPrefix);
    return names
      .map((n) => this.skills.get(n))
      .filter((s): s is SkillDef => s !== undefined);
  }

  // ─── Metrics ────────────────────────────────────────────────────────────────

  /** Record a skill invocation. */
  recordInvocation(
    name: string,
    outcome: { success: boolean; tokens: number; latency: number },
  ): void {
    let m = this.metrics.get(name);
    if (!m) {
      m = {
        name,
        invocations: 0,
        successes: 0,
        failures: 0,
        avgTokens: 0,
        avgLatency: 0,
        userOverrides: 0,
        lastUsed: 0,
        status: "active",
        errorPatterns: [],
      };
      this.metrics.set(name, m);
    }

    m.invocations++;
    m.lastUsed = Date.now();

    if (outcome.success) {
      m.successes++;
    } else {
      m.failures++;
    }

    // Rolling average
    m.avgTokens = (m.avgTokens * (m.invocations - 1) + outcome.tokens) / m.invocations;
    m.avgLatency = (m.avgLatency * (m.invocations - 1) + outcome.latency) / m.invocations;

    this.metricsDirty = true;
  }

  /** Record a user override (user rejected skill output). */
  recordOverride(name: string): void {
    const m = this.metrics.get(name);
    if (m) {
      m.userOverrides++;
      this.metricsDirty = true;
    }
  }

  /** Record an error pattern for annealing analysis. */
  recordErrorPattern(name: string, errorPattern: string): void {
    const m = this.metrics.get(name);
    if (!m) return;

    const existing = m.errorPatterns.find((e) => e.pattern === errorPattern);
    if (existing) {
      existing.count++;
    } else {
      m.errorPatterns.push({ pattern: errorPattern, count: 1 });
    }

    this.metricsDirty = true;
  }

  /** Get metrics for a skill. */
  getMetrics(name: string): SkillMetrics | undefined {
    return this.metrics.get(name);
  }

  /** Get all metrics. */
  getAllMetrics(): SkillMetrics[] {
    return Array.from(this.metrics.values());
  }

  /** Update skill status (for curation). */
  setStatus(name: string, status: SkillMetrics["status"]): void {
    const m = this.metrics.get(name);
    if (m) {
      m.status = status;
      this.metricsDirty = true;
    }
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  /** Save a synthesized pattern to disk. */
  savePattern(pattern: PatternDef): string {
    const dir = path.join(chorusHome(), "skills", "patterns");
    fs.mkdirSync(dir, { recursive: true });

    const skillDef: SkillDef = {
      name: pattern.name,
      description: pattern.description,
      instructions: `Auto-synthesized pattern from ${pattern.evidenceCount} trajectories.\n\nParameters:\n${pattern.parameters.map((p) => `- ${p.name}: ${p.type} — ${p.description}`).join("\n")}`,
      workflow: pattern.workflow,
      synthesized: true,
      sourceTrajectories: pattern.sourceTrajectories,
      updatedAt: pattern.synthesizedAt,
    };

    return saveSkillFile(skillDef, dir);
  }

  private loadMetrics(): void {
    try {
      const filePath = path.join(chorusHome(), "skill-metrics.json");
      if (!fs.existsSync(filePath)) return;

      const raw = fs.readFileSync(filePath, "utf-8");
      const data: SerializedSkillMetrics = JSON.parse(raw);

      if (data.version !== 1) return;

      for (const [name, metric] of Object.entries(data.metrics)) {
        this.metrics.set(name, metric);
      }
    } catch {
      // ignore corrupt metrics files
    }
  }

  saveMetrics(): void {
    if (!this.metricsDirty) return;

    const data: SerializedSkillMetrics = {
      version: 1,
      metrics: Object.fromEntries(this.metrics),
      updatedAt: Date.now(),
    };

    try {
      const dir = chorusHome();
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "skill-metrics.json");
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tmp, filePath);
      this.metricsDirty = false;
    } catch {
      // never crash on metrics persistence failure
    }
  }

  // ─── Hot Reload ─────────────────────────────────────────────────────────────

  private setupWatchers(): void {
    for (const dir of this.skillDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (filename && filename.toLowerCase().endsWith("skill.md")) {
            // Debounce reload
            this.debouncedReload();
          }
        });
        this.watchers.push(watcher);
      } catch {
        // ignore watcher setup failures
      }
    }
  }

  private reloadTimeout: NodeJS.Timeout | null = null;

  private debouncedReload(): void {
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }
    this.reloadTimeout = setTimeout(() => {
      void this.reload();
    }, 500);
  }
}
