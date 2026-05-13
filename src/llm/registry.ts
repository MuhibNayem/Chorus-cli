import { withRetry } from "./retry.js";
import { streamOllama, type OllamaStreamOptions } from "../ollama/client.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";

// Provider IDs available via CHORUS_FALLBACK_PROVIDERS env var
const FALLBACK_PROVIDERS = (process.env.CHORUS_FALLBACK_PROVIDERS ?? "ollama").split(",").map((s) => s.trim());

interface CircuitState {
  failures: number;
  skipUntil: number;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

const circuitState = new Map<string, CircuitState>();

function getCircuit(provider: string): CircuitState {
  if (!circuitState.has(provider)) {
    circuitState.set(provider, { failures: 0, skipUntil: 0 });
  }
  return circuitState.get(provider)!;
}

function recordFailure(provider: string): void {
  const state = getCircuit(provider);
  state.failures++;
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.skipUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    state.failures = 0;
  }
}

function recordSuccess(provider: string): void {
  const state = getCircuit(provider);
  state.failures = 0;
  state.skipUntil = 0;
}

function isOpen(provider: string): boolean {
  const state = getCircuit(provider);
  if (state.skipUntil > 0 && Date.now() < state.skipUntil) return true;
  if (state.skipUntil > 0 && Date.now() >= state.skipUntil) {
    // Circuit half-open: allow one attempt
    state.skipUntil = 0;
  }
  return false;
}

export interface ProviderCallOptions {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  onResponse: (chunk: string) => void;
  onComplete: (usage?: { inputTokens: number; outputTokens: number }) => void;
  onError: (err: Error) => void;
}

async function callOllama(opts: ProviderCallOptions): Promise<void> {
  return withRetry(
    () =>
      new Promise<void>((resolve, reject) => {
        streamOllama({
          baseUrl: OLLAMA_BASE_URL,
          model: MODEL_NAME,
          systemPrompt: opts.systemPrompt,
          messages: opts.messages,
          onThink: () => {},
          onResponse: opts.onResponse,
          onComplete: (usage) => { opts.onComplete(usage); resolve(); },
          onError: (err) => { reject(err); },
        });
      }),
    { maxAttempts: 3, baseDelayMs: 1_000 }
  );
}

export async function callProviderWithFallback(opts: ProviderCallOptions): Promise<void> {
  for (const provider of FALLBACK_PROVIDERS) {
    if (isOpen(provider)) continue;

    try {
      if (provider === "ollama") {
        await callOllama(opts);
        recordSuccess(provider);
        return;
      }
      // Placeholder: other providers (openai, groq) would be called here
      throw new Error(`Provider ${provider} not yet implemented`);
    } catch (err) {
      recordFailure(provider);
      if (process.env.DEBUG === "1") {
        console.error(`[registry] Provider ${provider} failed, trying next:`, err);
      }
    }
  }
  opts.onError(new Error("All providers failed or circuit-broken"));
}

export function getCircuitBreakerStatus(): Record<string, CircuitState> {
  const result: Record<string, CircuitState> = {};
  for (const [provider, state] of circuitState.entries()) {
    result[provider] = { ...state };
  }
  return result;
}
