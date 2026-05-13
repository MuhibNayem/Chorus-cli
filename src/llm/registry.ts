import type { LLMProvider } from "./provider.js";
import { getPreferredProviderName, normalizeProviderName } from "./config.js";
import { OllamaProvider } from "./ollamaProvider.js";
import { VllmProvider } from "./vllmProvider.js";

let defaultProviderPromise: Promise<LLMProvider> | null = null;

export function createProvider(name: string): LLMProvider {
  if (name === "ollama") return new OllamaProvider();
  const providerName = normalizeProviderName(name) ?? "deepseek";
  return new VllmProvider({ name: providerName });
}

export async function getDefaultProvider(): Promise<LLMProvider> {
  if (!defaultProviderPromise) {
    defaultProviderPromise = Promise.resolve(createProvider(getPreferredProviderName()));
  }
  return defaultProviderPromise;
}

export function resetDefaultProvider(): void {
  defaultProviderPromise = null;
}

export function resetProviderConfigCaches(): void {
  resetDefaultProvider();
}

export function setDefaultProvider(provider: LLMProvider): void {
  defaultProviderPromise = Promise.resolve(provider);
}
