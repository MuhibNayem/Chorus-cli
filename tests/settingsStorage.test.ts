import { describe, expect, it } from "vitest";
import { getMissingLlmSettings, hasRequiredLlmSettings } from "../src/settings/storage.js";

describe("settings storage validation", () => {
  it("reports provider missing when settings are empty", () => {
    expect(getMissingLlmSettings({})).toEqual(["provider"]);
    expect(hasRequiredLlmSettings({})).toBe(false);
  });

  it("reports missing fields for the selected provider only", () => {
    const settings = {
      llm: {
        provider: "deepseek",
        providers: {
          deepseek: {},
        },
      },
    };

    expect(getMissingLlmSettings(settings)).toEqual([
      "deepseek.apiKey",
      "deepseek.model",
    ]);
    expect(hasRequiredLlmSettings(settings)).toBe(false);
  });

  it("accepts complete settings for a cloud provider", () => {
    const settings = {
      llm: {
        provider: "deepseek",
        providers: {
          deepseek: {
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-test",
            model: "deepseek-chat",
          },
        },
      },
    };

    expect(getMissingLlmSettings(settings)).toEqual([]);
    expect(hasRequiredLlmSettings(settings)).toBe(true);
  });

  it("accepts complete settings for a local provider without apiKey", () => {
    const settings = {
      llm: {
        provider: "ollama",
        providers: {
          ollama: {
            baseUrl: "http://localhost:11434",
            model: "llama3",
          },
        },
      },
    };

    expect(getMissingLlmSettings(settings)).toEqual([]);
    expect(hasRequiredLlmSettings(settings)).toBe(true);
  });

  it("accepts complete global LLM settings with legacy multi-provider config", () => {
    const settings = {
      llm: {
        provider: "ollama",
        providers: {
          ollama: {
            baseUrl: "http://localhost:11434",
            model: "batiai/gemma4-e2b:q4",
          },
          vllm: {
            baseUrl: "http://127.0.0.1:8000/v1",
            apiKey: "EMPTY",
            model: "google/gemma-4-E2B-it",
          },
        },
      },
    };

    expect(getMissingLlmSettings(settings)).toEqual([]);
    expect(hasRequiredLlmSettings(settings)).toBe(true);
  });
});
