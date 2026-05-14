import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useSpinner } from "../cli/hooks/useSpinner.js";
import { ALL_PROVIDERS, getProviderById } from "./providers.js";
import {
  loadSettings,
  saveSettings,
  saveApiKeys,
  clearSettingsCache,
  getSerperApiKey,
  getGoogleCseApiKey,
  getGoogleCseId,
  getWeatherApiKey,
  type ChorusSettings,
} from "./storage.js";

type Phase =
  | "select-provider"
  | "enter-baseurl"
  | "enter-llm-apikey"
  | "fetching-models"
  | "select-model"
  | "enter-serper"
  | "enter-google-cse-key"
  | "enter-google-cse-id"
  | "enter-weather"
  | "review"
  | "error";

type State = {
  phase: Phase;
  // LLM
  providerIndex: number;
  providerId: string;
  baseUrl: string;
  llmApiKey: string;
  models: string[];
  modelIndex: number;
  // Tool API keys
  serperKey: string;
  googleCseKey: string;
  googleCseId: string;
  weatherKey: string;
  // misc
  error: string | null;
};

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "••••••••";
  return k.slice(0, 4) + "••••" + k.slice(-4);
}

function buildInitialState(): State {
  const settings = loadSettings();
  const savedProviderId = settings.llm?.provider ?? "";
  const providerIndex = Math.max(
    0,
    ALL_PROVIDERS.findIndex((p) => p.id === savedProviderId)
  );
  const provider = ALL_PROVIDERS[providerIndex] ?? ALL_PROVIDERS[0]!;
  const pSettings = settings.llm?.providers?.[provider.id] ?? {};

  // For tool keys, read from settings only (env values are shown but not editable here)
  const settingsApiKeys = settings.apiKeys ?? {};

  return {
    phase: "select-provider",
    providerIndex,
    providerId: provider.id,
    baseUrl: pSettings.baseUrl ?? provider.defaultBaseUrl,
    llmApiKey: pSettings.apiKey ?? "",
    models: [],
    modelIndex: 0,
    serperKey: settingsApiKeys.serper ?? "",
    googleCseKey: settingsApiKeys.googleCseKey ?? "",
    googleCseId: settingsApiKeys.googleCseId ?? "",
    weatherKey: settingsApiKeys.weather ?? "",
    error: null,
  };
}

function phaseAfterProvider(state: State): Phase {
  const p = getProviderById(state.providerId);
  if (p?.allowCustomBaseUrl) return "enter-baseurl";
  if (p?.requiresApiKey) return "enter-llm-apikey";
  return "fetching-models";
}

function phaseAfterBaseUrl(state: State): Phase {
  const p = getProviderById(state.providerId);
  return p?.requiresApiKey ? "enter-llm-apikey" : "fetching-models";
}

function phaseBack(state: State): Phase {
  const p = getProviderById(state.providerId);
  switch (state.phase) {
    case "enter-baseurl":     return "select-provider";
    case "enter-llm-apikey":  return p?.allowCustomBaseUrl ? "enter-baseurl" : "select-provider";
    case "fetching-models":
    case "select-model":
      if (p?.requiresApiKey) return "enter-llm-apikey";
      if (p?.allowCustomBaseUrl) return "enter-baseurl";
      return "select-provider";
    case "enter-serper":      return "select-model";
    case "enter-google-cse-key": return "enter-serper";
    case "enter-google-cse-id":  return "enter-google-cse-key";
    case "enter-weather":        return "enter-google-cse-id";
    case "review":               return "enter-weather";
    case "error":                return "select-provider";
    default:                     return "select-provider";
  }
}

type Props = { onDone: (saved: boolean) => void };

export function ConfigWizard({ onDone }: Props) {
  const [state, setState] = useState<State>(buildInitialState);

  // Fetch models when entering fetching-models
  useEffect(() => {
    if (state.phase !== "fetching-models") return;
    const provider = getProviderById(state.providerId);
    if (!provider) {
      setState((s) => ({ ...s, phase: "error", error: "Unknown provider" }));
      return;
    }
    let cancelled = false;
    provider
      .listModels(state.baseUrl, state.llmApiKey)
      .then((fetched) => {
        if (cancelled) return;
        if (fetched.length === 0) {
          setState((s) => ({ ...s, phase: "error", error: "No models found for this provider." }));
          return;
        }
        // If saved model exists but isn't in list, prepend it
        const settings = loadSettings();
        const savedModel = settings.llm?.providers?.[state.providerId]?.model ?? "";
        const models = savedModel && !fetched.includes(savedModel)
          ? [savedModel, ...fetched]
          : fetched;
        const modelIndex = Math.max(0, models.indexOf(savedModel));
        setState((s) => ({ ...s, phase: "select-model", models, modelIndex, error: null }));
      })
      .catch((err) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          phase: "error",
          error: `Failed to fetch models: ${err instanceof Error ? err.message : String(err)}`,
        }));
      });
    return () => { cancelled = true; };
  }, [state.phase, state.providerId, state.baseUrl, state.llmApiKey]);

  const spinner = useSpinner(state.phase === "fetching-models");
  const provider = getProviderById(state.providerId);

  const localProviders = ALL_PROVIDERS.filter((p) => p.category === "local");
  const cloudProviders = ALL_PROVIDERS.filter((p) => p.category === "cloud");

  useInput((input, key) => {
    if (key.ctrl && input === "c") process.exit(0);

    if (key.escape) {
      if (state.phase === "select-provider") { onDone(false); return; }
      setState((s) => ({ ...s, phase: phaseBack(s), error: null }));
      return;
    }

    if (state.phase === "select-provider") {
      if (key.upArrow)   setState((s) => ({ ...s, providerIndex: Math.max(0, s.providerIndex - 1) }));
      if (key.downArrow) setState((s) => ({ ...s, providerIndex: Math.min(ALL_PROVIDERS.length - 1, s.providerIndex + 1) }));
      if (key.return) {
        const p = ALL_PROVIDERS[state.providerIndex]!;
        setState((s) => ({
          ...s,
          providerId: p.id,
          baseUrl: p.defaultBaseUrl,
          llmApiKey: loadSettings().llm?.providers?.[p.id]?.apiKey ?? "",
          phase: phaseAfterProvider({ ...s, providerId: p.id }),
          error: null,
        }));
      }
      return;
    }

    if (state.phase === "select-model") {
      if (key.upArrow)   setState((s) => ({ ...s, modelIndex: Math.max(0, s.modelIndex - 1) }));
      if (key.downArrow) setState((s) => ({ ...s, modelIndex: Math.min(s.models.length - 1, s.modelIndex + 1) }));
      if (key.return)    setState((s) => ({ ...s, phase: "enter-serper", error: null }));
      return;
    }

    if (state.phase === "review") {
      if (key.return) handleSave();
      return;
    }

    if (state.phase === "error") {
      if (key.return && state.error?.startsWith("Failed to fetch")) {
        setState((s) => ({ ...s, phase: "fetching-models", error: null }));
      } else {
        setState((s) => ({ ...s, phase: "select-provider", error: null }));
      }
      return;
    }
    // text-input phases handled via onSubmit
  });

  function handleTextSubmit(value: string, field: keyof State, nextPhase: Phase) {
    setState((s) => ({ ...s, [field]: value, phase: nextPhase, error: null }));
  }

  function handleBaseUrlSubmit(value: string) {
    const v = value.trim();
    if (!v) { setState((s) => ({ ...s, error: "Base URL is required." })); return; }
    setState((s) => ({ ...s, baseUrl: v, phase: phaseAfterBaseUrl(s), error: null }));
  }

  function handleSave() {
    const existing = loadSettings();
    const chosenModel = state.models[state.modelIndex] ?? "";

    const updated: ChorusSettings = {
      ...existing,
      llm: {
        ...existing.llm,
        provider: state.providerId,
        providers: {
          ...existing.llm?.providers,
          [state.providerId]: {
            baseUrl: state.baseUrl.trim() || undefined,
            apiKey: state.llmApiKey.trim() || undefined,
            model: chosenModel,
          },
        },
      },
    };
    saveSettings(updated);
    saveApiKeys({
      serper: state.serperKey.trim() || undefined,
      googleCseKey: state.googleCseKey.trim() || undefined,
      googleCseId: state.googleCseId.trim() || undefined,
      weather: state.weatherKey.trim() || undefined,
    });
    clearSettingsCache();
    onDone(true);
  }

  const STEP_LABELS: Record<Phase, string> = {
    "select-provider":      "Step 1/7 — LLM Provider",
    "enter-baseurl":        "Step 2/7 — Base URL",
    "enter-llm-apikey":     "Step 3/7 — LLM API Key",
    "fetching-models":      "Step 4/7 — Fetching models…",
    "select-model":         "Step 4/7 — Select Model",
    "enter-serper":         "Step 5/7 — Serper API key",
    "enter-google-cse-key": "Step 6/7 — Google CSE API key",
    "enter-google-cse-id":  "Step 6/7 — Google CSE ID",
    "enter-weather":        "Step 7/7 — Weather API key",
    "review":               "Review & Save",
    "error":                "Error",
  };

  const HINTS: Partial<Record<Phase, string>> = {
    "select-provider":      "[↑↓] navigate  [Enter] select  [Esc] cancel",
    "enter-baseurl":        "[Enter] confirm  [Esc] back",
    "enter-llm-apikey":     "[Enter] confirm  [Esc] back",
    "fetching-models":      "[Esc] back",
    "select-model":         "[↑↓] navigate  [Enter] confirm  [Esc] back",
    "enter-serper":         "[Enter] confirm (empty = keep existing)  [Esc] back",
    "enter-google-cse-key": "[Enter] confirm  [Esc] back",
    "enter-google-cse-id":  "[Enter] confirm  [Esc] back",
    "enter-weather":        "[Enter] confirm  [Esc] back",
    "review":               "[Enter] save  [Esc] back",
    "error":                "[Enter] retry  [Esc] start over",
  };

  // Env-shadow warnings for tool keys
  const envShadowed: Record<string, string> = {};
  if (process.env.SERPER_API_KEY)     envShadowed.serper = "SERPER_API_KEY";
  if (process.env.GOOGLE_CSE_API_KEY) envShadowed.googleCseKey = "GOOGLE_CSE_API_KEY";
  if (process.env.GOOGLE_CSE_ID)      envShadowed.googleCseId = "GOOGLE_CSE_ID";
  if (process.env.WEATHER_API_KEY)    envShadowed.weather = "WEATHER_API_KEY";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>{"chorus config"}</Text>
        <Text color="grey" dimColor>{"  · full setup wizard"}</Text>
      </Box>

      {/* Step label */}
      <Text bold>{STEP_LABELS[state.phase]}</Text>
      {HINTS[state.phase] && (
        <Text color="grey" dimColor>{HINTS[state.phase]}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>

        {/* ── Step 1: Provider ── */}
        {state.phase === "select-provider" && (
          <>
            <Text color="yellow" bold>{"Local"}</Text>
            {localProviders.map((p) => {
              const gi = ALL_PROVIDERS.findIndex((ap) => ap.id === p.id);
              const selected = gi === state.providerIndex;
              const isCurrent = p.id === loadSettings().llm?.provider;
              return (
                <Text key={p.id} color={selected ? "cyan" : "white"} bold={selected}>
                  {selected ? "▶ " : "  "}
                  {p.label}
                  {isCurrent && !selected ? <Text color="grey" dimColor>{"  (current)"}</Text> : null}
                </Text>
              );
            })}
            <Box marginTop={1}><Text color="yellow" bold>{"Cloud"}</Text></Box>
            {cloudProviders.map((p) => {
              const gi = ALL_PROVIDERS.findIndex((ap) => ap.id === p.id);
              const selected = gi === state.providerIndex;
              const isCurrent = p.id === loadSettings().llm?.provider;
              return (
                <Text key={p.id} color={selected ? "cyan" : "white"} bold={selected}>
                  {selected ? "▶ " : "  "}
                  {p.label}
                  {isCurrent && !selected ? <Text color="grey" dimColor>{"  (current)"}</Text> : null}
                </Text>
              );
            })}
          </>
        )}

        {/* ── Step 2: Base URL ── */}
        {state.phase === "enter-baseurl" && (
          <>
            <Text color="grey" dimColor>{`For ${provider?.label}`}</Text>
            <Box flexDirection="row" marginTop={1}>
              <Text color="cyan" bold>{"> "}</Text>
              <TextInput
                value={state.baseUrl}
                onChange={(v) => setState((s) => ({ ...s, baseUrl: v, error: null }))}
                onSubmit={handleBaseUrlSubmit}
                focus
              />
            </Box>
            {state.error && <Text color="red">{state.error}</Text>}
          </>
        )}

        {/* ── Step 3: LLM API key ── */}
        {state.phase === "enter-llm-apikey" && (
          <>
            <Text color="grey" dimColor>{provider?.apiKeyLabel ?? "API key"}</Text>
            {state.llmApiKey && (
              <Text color="grey" dimColor>{`Current: ${maskKey(state.llmApiKey)}`}</Text>
            )}
            <Box flexDirection="row" marginTop={1}>
              <Text color="cyan" bold>{"> "}</Text>
              <TextInput
                value={state.llmApiKey}
                onChange={(v) => setState((s) => ({ ...s, llmApiKey: v, error: null }))}
                onSubmit={(v) => handleTextSubmit(v, "llmApiKey", "fetching-models")}
                focus
                mask="•"
              />
            </Box>
          </>
        )}

        {/* ── Step 4a: Fetching models ── */}
        {state.phase === "fetching-models" && (
          <Text><Text color="cyan">{spinner}</Text>{" contacting API…"}</Text>
        )}

        {/* ── Step 4b: Select model ── */}
        {state.phase === "select-model" && (
          <Box flexDirection="column">
            {state.models.map((m, i) => {
              const selected = i === state.modelIndex;
              return (
                <Text key={m} color={selected ? "cyan" : "white"} bold={selected}>
                  {selected ? "▶ " : "  "}{m}
                </Text>
              );
            })}
          </Box>
        )}

        {/* ── Step 5-7: Tool API keys ── */}
        {state.phase === "enter-serper" && (
          <ApiKeyInput
            label="Serper API key"
            envVar={envShadowed.serper}
            value={state.serperKey}
            envValue={process.env.SERPER_API_KEY}
            onChange={(v) => setState((s) => ({ ...s, serperKey: v }))}
            onSubmit={(v) => handleTextSubmit(v, "serperKey", "enter-google-cse-key")}
          />
        )}
        {state.phase === "enter-google-cse-key" && (
          <ApiKeyInput
            label="Google CSE API key"
            envVar={envShadowed.googleCseKey}
            value={state.googleCseKey}
            envValue={process.env.GOOGLE_CSE_API_KEY}
            onChange={(v) => setState((s) => ({ ...s, googleCseKey: v }))}
            onSubmit={(v) => handleTextSubmit(v, "googleCseKey", "enter-google-cse-id")}
          />
        )}
        {state.phase === "enter-google-cse-id" && (
          <ApiKeyInput
            label="Google CSE ID"
            envVar={envShadowed.googleCseId}
            value={state.googleCseId}
            envValue={process.env.GOOGLE_CSE_ID}
            onChange={(v) => setState((s) => ({ ...s, googleCseId: v }))}
            onSubmit={(v) => handleTextSubmit(v, "googleCseId", "enter-weather")}
            mask={false}
          />
        )}
        {state.phase === "enter-weather" && (
          <ApiKeyInput
            label="Weather API key"
            envVar={envShadowed.weather}
            value={state.weatherKey}
            envValue={process.env.WEATHER_API_KEY}
            onChange={(v) => setState((s) => ({ ...s, weatherKey: v }))}
            onSubmit={(v) => handleTextSubmit(v, "weatherKey", "review")}
          />
        )}

        {/* ── Review ── */}
        {state.phase === "review" && (
          <Box flexDirection="column" gap={0}>
            <Text color="yellow" bold>{"LLM"}</Text>
            <Text>{"  Provider  "}<Text color="cyan">{provider?.label ?? state.providerId}</Text></Text>
            {provider?.allowCustomBaseUrl && (
              <Text>{"  Base URL  "}<Text color="cyan">{state.baseUrl}</Text></Text>
            )}
            {provider?.requiresApiKey && (
              <Text>{"  API Key   "}<Text color="cyan">{maskKey(state.llmApiKey)}</Text></Text>
            )}
            <Text>{"  Model     "}<Text color="cyan">{state.models[state.modelIndex] ?? "(none)"}</Text></Text>

            <Box marginTop={1}><Text color="yellow" bold>{"Tool API Keys"}</Text></Box>
            <ReviewKeyRow label="Serper"         value={state.serperKey}     envVar={envShadowed.serper} />
            <ReviewKeyRow label="Google CSE key" value={state.googleCseKey}  envVar={envShadowed.googleCseKey} />
            <ReviewKeyRow label="Google CSE ID"  value={state.googleCseId}   envVar={envShadowed.googleCseId} mask={false} />
            <ReviewKeyRow label="Weather"        value={state.weatherKey}    envVar={envShadowed.weather} />
          </Box>
        )}

        {/* ── Error ── */}
        {state.phase === "error" && (
          <Text color="red">{state.error}</Text>
        )}
      </Box>
    </Box>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type ApiKeyInputProps = {
  label: string;
  envVar?: string;
  value: string;
  envValue?: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  mask?: boolean;
};

function ApiKeyInput({ label, envVar, value, envValue, onChange, onSubmit, mask = true }: ApiKeyInputProps) {
  return (
    <>
      {envVar && envValue && (
        <Text color="yellow">{`  $${envVar} is set in env — it will override this value`}</Text>
      )}
      {!value && !envValue && (
        <Text color="grey" dimColor>{"  Currently not set — press Enter to skip"}</Text>
      )}
      {(value || envValue) && (
        <Text color="grey" dimColor>
          {"  Current: "}
          <Text color="green">{mask ? maskKey(value || envValue!) : (value || envValue!)}</Text>
          {envVar && envValue ? <Text color="yellow">{" [env]"}</Text> : null}
        </Text>
      )}
      <Box flexDirection="row" marginTop={1}>
        <Text color="cyan" bold>{"> "}</Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          focus
          mask={mask ? "•" : undefined}
        />
      </Box>
    </>
  );
}

type ReviewKeyRowProps = { label: string; value: string; envVar?: string; mask?: boolean };

function ReviewKeyRow({ label, value, envVar, mask = true }: ReviewKeyRowProps) {
  const display = value
    ? (mask ? maskKey(value) : value)
    : "(not set)";
  return (
    <Text>
      {"  "}{label.padEnd(16)}
      <Text color={value ? "green" : "grey"}>{display}</Text>
      {envVar ? <Text color="yellow">{" [env shadows]"}</Text> : null}
    </Text>
  );
}
