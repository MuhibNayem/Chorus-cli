/**
 * SkillIndex — In-Memory Semantic Search with LRU Cache
 *
 * Zero external dependencies. No vector DB required.
 * Persists to ~/.chorus/skill-index.json for fast reload.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { SkillDef, PatternDef, SkillMatch, SkillEmbedder, SerializedSkillIndex, SkillIndexEntry } from "./types.js";
import { cosineSimilarity } from "./embedder.js";

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

interface IndexNode {
  name: string;
  description: string;
  vector: number[];
  kind: "skill" | "pattern";
  tags: string[];
  lastAccessed: number;
}

export class SkillIndex {
  private nodes: Map<string, IndexNode> = new Map();
  private embedder: SkillEmbedder;
  private maxSize: number;
  private dirty = false;

  constructor(embedder: SkillEmbedder, maxSize = 1000) {
    this.embedder = embedder;
    this.maxSize = maxSize;
    this.loadFromDisk();
  }

  /** Add or update a skill/pattern in the index. */
  async indexSkill(skill: SkillDef | PatternDef, kind: "skill" | "pattern"): Promise<void> {
    const text = `${skill.name}. ${skill.description}`;
    const vector = await this.embedder.embed(text);
    const tags = "tags" in skill ? (skill.tags ?? []) : [];

    this.nodes.set(skill.name, {
      name: skill.name,
      description: skill.description,
      vector,
      kind,
      tags,
      lastAccessed: Date.now(),
    });

    this.dirty = true;
    this.evictIfNeeded();
  }

  /** Remove a skill/pattern from the index. */
  remove(name: string): void {
    if (this.nodes.delete(name)) {
      this.dirty = true;
    }
  }

  /** Semantic search: find top-K relevant skills/patterns for a query. */
  async search(query: string, topK = 10, minScore = 0.0): Promise<SkillMatch[]> {
    if (this.nodes.size === 0) return [];

    const queryVector = await this.embedder.embed(query);
    const scored: Array<{ node: IndexNode; score: number }> = [];

    for (const node of this.nodes.values()) {
      if (node.vector.length !== queryVector.length) {
        continue;
      }
      const score = cosineSimilarity(queryVector, node.vector);
      if (score >= minScore) {
        scored.push({ node, score });
        node.lastAccessed = Date.now();
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    // We return matches with a placeholder skill reference.
    // The registry resolves names to actual SkillDef/PatternDef objects.
    return top.map(({ node, score }) => ({
      skill: { name: node.name, description: node.description } as SkillDef | PatternDef,
      score,
      kind: node.kind,
    }));
  }

  /** Search by tag prefix (fast, no embedding needed). */
  searchByTag(tagPrefix: string): string[] {
    const matches: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.tags.some((t) => t.startsWith(tagPrefix))) {
        matches.push(node.name);
      }
    }
    return matches;
  }

  /** Check if a name is indexed. */
  has(name: string): boolean {
    return this.nodes.has(name);
  }

  /** Number of indexed entries. */
  size(): number {
    return this.nodes.size;
  }

  /** Persist index to disk. */
  saveToDisk(): void {
    if (!this.dirty) return;

    const data: SerializedSkillIndex = {
      version: 2,
      modelId: this.embedder.modelId,
      dimensions: this.embedder.dimensions,
      entries: Array.from(this.nodes.values()).map((n) => ({
        name: n.name,
        description: n.description,
        vector: n.vector,
        kind: n.kind,
        tags: n.tags,
      })),
      generatedAt: Date.now(),
    };

    try {
      const dir = chorusHome();
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "skill-index.json");
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tmp, filePath);
      this.dirty = false;
    } catch {
      // never crash on index persistence failure
    }
  }

  /** Load index from disk. */
  private loadFromDisk(): void {
    try {
      const filePath = path.join(chorusHome(), "skill-index.json");
      if (!fs.existsSync(filePath)) return;

      const raw = fs.readFileSync(filePath, "utf-8");
      const data: SerializedSkillIndex = JSON.parse(raw);

      if (data.version !== 2) return;
      if (this.embedder.modelId && data.modelId && data.modelId !== this.embedder.modelId) return;
      if (this.embedder.dimensions && data.dimensions && data.dimensions !== this.embedder.dimensions) return;

      for (const entry of data.entries) {
        if (this.embedder.dimensions && entry.vector.length !== this.embedder.dimensions) {
          continue;
        }
        this.nodes.set(entry.name, {
          name: entry.name,
          description: entry.description,
          vector: entry.vector,
          kind: entry.kind,
          tags: entry.tags,
          lastAccessed: data.generatedAt,
        });
      }
    } catch {
      // ignore corrupt index files
    }
  }

  /** Evict least-recently accessed entries if over capacity. */
  private evictIfNeeded(): void {
    if (this.nodes.size <= this.maxSize) return;

    const sorted = Array.from(this.nodes.entries()).sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed,
    );
    const toEvict = sorted.slice(0, this.nodes.size - this.maxSize);
    for (const [name] of toEvict) {
      this.nodes.delete(name);
    }
    this.dirty = true;
  }
}
