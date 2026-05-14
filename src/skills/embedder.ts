/**
 * Skill Embedder — Pluggable text embedding for semantic skill routing.
 *
 * Default: local MiniLM sentence embeddings via Transformers.js.
 * Fallback: deterministic keyword vectors if the model cannot be loaded.
 */

import * as os from "os";
import * as path from "path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { SkillEmbedder } from "./types.js";

export const MINILM_EMBEDDING_MODEL =
  process.env.CHORUS_EMBEDDING_MODEL ?? "onnx-community/all-MiniLM-L6-v2-ONNX";
export const MINILM_EMBEDDING_DIMENSIONS = 384;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "this", "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
  "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
]);

const VECTOR_DIM = 256;
const extractorPromises = new Map<string, Promise<FeatureExtractionPipeline>>();

function chorusHome(): string {
  return process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
}

export function getModelCacheDir(): string {
  return process.env.CHORUS_MODELS_DIR ?? path.join(chorusHome(), "models");
}

function configureTransformersCache(): void {
  env.cacheDir = getModelCacheDir();
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.useFSCache = true;
}

/** Simple keyword-based embedding using weighted term frequency. */
export class KeywordEmbedder implements SkillEmbedder {
  readonly modelId = "keyword-hash-v1";
  readonly dimensions = VECTOR_DIM;

  private vocabulary: Map<string, number> = new Map();
  private nextId = 0;

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  }

  private getId(term: string): number {
    let id = this.vocabulary.get(term);
    if (id === undefined) {
      id = this.nextId++;
      this.vocabulary.set(term, id);
    }
    return id;
  }

  async embed(text: string): Promise<number[]> {
    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      return new Array(VECTOR_DIM).fill(0);
    }

    const vec = new Array(VECTOR_DIM).fill(0);
    const tf: Map<string, number> = new Map();

    // Term frequency
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Weighted hashing into fixed-size vector
    for (const [token, count] of tf.entries()) {
      const id = this.getId(token);
      const weight = 1 + Math.log(count);

      // Distribute term across multiple dimensions via hashing
      for (let i = 0; i < 4; i++) {
        const dim = ((id * 31 + i * 17) % VECTOR_DIM + VECTOR_DIM) % VECTOR_DIM;
        vec[dim] += weight * (i % 2 === 0 ? 1 : -1);
      }
    }

    // L2 normalize
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < VECTOR_DIM; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }
}

/** Local sentence-transformer embeddings backed by all-MiniLM-L6-v2. */
export class MiniLMEmbedder implements SkillEmbedder {
  readonly modelId: string;
  readonly dimensions = MINILM_EMBEDDING_DIMENSIONS;

  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
  private fallback = new KeywordEmbedder();
  private warned = false;

  constructor(modelId = MINILM_EMBEDDING_MODEL) {
    this.modelId = modelId;
  }

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    const shared = extractorPromises.get(this.modelId);
    if (shared) {
      this.extractorPromise = shared;
      return shared;
    }

    if (!this.extractorPromise) {
      configureTransformersCache();
      this.extractorPromise = pipeline("feature-extraction", this.modelId);
      extractorPromises.set(this.modelId, this.extractorPromise);
    }
    return this.extractorPromise;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const extractor = await this.getExtractor();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const values = output.tolist() as number[] | number[][];
      const vector = Array.isArray(values[0])
        ? values[0] as number[]
        : values as number[];

      if (vector.length !== MINILM_EMBEDDING_DIMENSIONS) {
        throw new Error(`Unexpected MiniLM vector size ${vector.length}`);
      }

      return vector.map((v) => Number(v));
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        process.stderr.write(
          `Chorus MiniLM embedder unavailable, falling back to keyword routing: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      return this.fallback.embed(text);
    }
  }
}

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Create the best available embedder. */
export function createEmbedder(): SkillEmbedder {
  if (process.env.CHORUS_EMBEDDER === "keyword") {
    return new KeywordEmbedder();
  }
  return new MiniLMEmbedder();
}
