#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = process.env.CHORUS_EMBEDDING_MODEL ?? "onnx-community/all-MiniLM-L6-v2-ONNX";
const homeDir = process.env.CHORUS_HOME_DIR ?? path.join(os.homedir(), ".chorus");
const cacheDir = process.env.CHORUS_MODELS_DIR ?? path.join(homeDir, "models");
const markerPath = path.join(cacheDir, "minilm-embedding-model.json");

async function main() {
  fs.mkdirSync(cacheDir, { recursive: true });

  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.useFSCache = true;

  process.stdout.write(`Chorus: downloading MiniLM embedding model (${MODEL_ID})...\n`);
  const extractor = await pipeline("feature-extraction", MODEL_ID);
  const output = await extractor("Chorus MiniLM embedding cache warmup.", {
    pooling: "mean",
    normalize: true,
  });
  const vector = output.tolist();
  const first = Array.isArray(vector[0]) ? vector[0] : vector;

  if (!Array.isArray(first) || first.length !== 384) {
    throw new Error(`Expected a 384-dimensional MiniLM embedding, got ${Array.isArray(first) ? first.length : "non-array"}`);
  }

  fs.writeFileSync(
    markerPath,
    JSON.stringify({
      modelId: MODEL_ID,
      dimensions: 384,
      cacheDir,
      downloadedAt: new Date().toISOString(),
    }, null, 2),
    "utf-8",
  );

  if (typeof extractor.dispose === "function") {
    await extractor.dispose();
  }

  process.stdout.write(`Chorus: MiniLM embedding model cached at ${cacheDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`Chorus: failed to download MiniLM embedding model: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
