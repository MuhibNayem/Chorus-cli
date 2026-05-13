import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearSettingsCache,
  getPreferredProviderName,
  getProviderModel,
  getProviderPreference,
  getSettingsPath,
  getSummaryModelForProvider,
  OllamaProvider,
  resetProviderConfigCaches,
  VllmProvider,
} from "../src/llm/index.js";

function writeSettings(homeDir: string, data: unknown): void {
  const chorusDir = path.join(homeDir, ".chorus");
  fs.mkdirSync(chorusDir, { recursive: true });
  fs.writeFileSync(path.join(chorusDir, "settings.json"), JSON.stringify(data, null, 2), "utf-8");
}

describe("global settings.json LLM config", () => {
  afterEach(() => {
    clearSettingsCache();
    resetProviderConfigCaches();
    delete process.env.CHORUS_HOME_DIR;
    delete process.env.LLM_PROVIDER;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_SUMMARY_MODEL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_MODEL;
    delete process.env.VLLM_SUMMARY_MODEL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.VLLM_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_MODEL;
  });

  it("loads provider preference and models from ~/.chorus/settings.json", () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-settings-"));
    process.env.CHORUS_HOME_DIR = homeDir;
    writeSettings(homeDir, {
      llm: {
        provider: "ollama",
        providers: {
          ollama: {
            model: "gemma-local",
            summaryModel: "gemma-local-summary",
            baseUrl: "http://127.0.0.1:11434",
          },
          vllm: {
            model: "gemma-vllm",
            summaryModel: "gemma-vllm-summary",
            baseUrl: "http://127.0.0.1:8000/v1",
            apiKey: "settings-key",
          },
        },
      },
    });

    clearSettingsCache();

    expect(getSettingsPath()).toBe(path.join(homeDir, ".chorus", "settings.json"));
    expect(getProviderPreference()).toBe("ollama");
    expect(getPreferredProviderName()).toBe("ollama");
    expect(getProviderModel("ollama")).toBe("gemma-local");
    expect(getSummaryModelForProvider("vllm")).toBe("gemma-vllm-summary");

    const ollama = new OllamaProvider() as any;
    const vllm = new VllmProvider() as any;

    expect(ollama.baseUrl).toBe("http://127.0.0.1:11434");
    expect(vllm.baseUrl).toBe("http://127.0.0.1:8000/v1");
    expect(vllm.apiKey).toBe("settings-key");
  });

  it("keeps environment variables higher priority than global settings", () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-settings-"));
    process.env.CHORUS_HOME_DIR = homeDir;
    writeSettings(homeDir, {
      llm: {
        provider: "ollama",
        providers: {
          ollama: {
            model: "settings-ollama",
          },
          vllm: {
            model: "settings-vllm",
            baseUrl: "http://settings-vllm:8000/v1",
            apiKey: "settings-key",
          },
        },
      },
    });

    process.env.LLM_PROVIDER = "vllm";
    process.env.VLLM_MODEL = "env-vllm";
    process.env.VLLM_BASE_URL = "http://env-vllm:8000/v1";
    process.env.VLLM_API_KEY = "env-key";

    clearSettingsCache();

    expect(getProviderPreference()).toBe("vllm");
    expect(getPreferredProviderName()).toBe("vllm");
    expect(getProviderModel("vllm")).toBe("env-vllm");

    const provider = new VllmProvider() as any;
    expect(provider.baseUrl).toBe("http://env-vllm:8000/v1");
    expect(provider.apiKey).toBe("env-key");
  });

  it("supports DeepSeek provider via settings", () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-settings-"));
    process.env.CHORUS_HOME_DIR = homeDir;
    writeSettings(homeDir, {
      llm: {
        provider: "deepseek",
        providers: {
          deepseek: {
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-deepseek",
            model: "deepseek-chat",
          },
        },
      },
    });

    clearSettingsCache();

    expect(getProviderPreference()).toBe("deepseek");
    expect(getPreferredProviderName()).toBe("deepseek");
    expect(getProviderModel("deepseek")).toBe("deepseek-chat");

    const provider = new VllmProvider({ name: "deepseek" }) as any;
    expect(provider.name).toBe("deepseek");
    expect(provider.baseUrl).toBe("https://api.deepseek.com");
    expect(provider.apiKey).toBe("sk-deepseek");
  });

  it("supports DeepSeek provider via environment variables", () => {
    process.env.LLM_PROVIDER = "deepseek";
    process.env.DEEPSEEK_MODEL = "deepseek-reasoner";
    process.env.DEEPSEEK_BASE_URL = "https://custom.deepseek.com";
    process.env.DEEPSEEK_API_KEY = "env-deepseek-key";

    clearSettingsCache();
    resetProviderConfigCaches();

    expect(getProviderPreference()).toBe("deepseek");
    expect(getProviderModel("deepseek")).toBe("deepseek-reasoner");

    const provider = new VllmProvider({ name: "deepseek" }) as any;
    expect(provider.baseUrl).toBe("https://custom.deepseek.com");
    expect(provider.apiKey).toBe("env-deepseek-key");
  });
});
