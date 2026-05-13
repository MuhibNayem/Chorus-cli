import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useSpinner } from "../cli/hooks/useSpinner.js";
import { ALL_PROVIDERS, getProviderById } from "./providers.js";
import type { ChorusSettings } from "./storage.js";

type WizardPhase =
  | "select-provider"
  | "enter-baseurl"
  | "enter-apikey"
  | "fetching-models"
  | "select-model"
  | "review"
  | "error";

type WizardState = {
  phase: WizardPhase;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelIndex: number;
  providerIndex: number;
  error: string | null;
};

type SettingsWizardProps = {
  initialSettings: ChorusSettings;
  onSubmit: (settings: ChorusSettings) => void;
};

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function getInitialState(settings: ChorusSettings): WizardState {
  const savedProvider = settings.llm?.provider ?? "";
  const providerIndex = Math.max(
    0,
    ALL_PROVIDERS.findIndex((p) => p.id === savedProvider)
  );
  const provider = ALL_PROVIDERS[providerIndex] ?? ALL_PROVIDERS[0];
  const pSettings = settings.llm?.providers?.[provider?.id ?? ""] ?? {};
  return {
    phase: "select-provider",
    providerId: provider?.id ?? "",
    baseUrl: pSettings.baseUrl ?? provider?.defaultBaseUrl ?? "",
    apiKey: pSettings.apiKey ?? "",
    models: [],
    modelIndex: 0,
    providerIndex,
    error: null,
  };
}

function buildSettings(state: WizardState): ChorusSettings {
  return {
    llm: {
      provider: state.providerId,
      providers: {
        [state.providerId]: {
          baseUrl: state.baseUrl.trim() || undefined,
          apiKey: state.apiKey.trim() || undefined,
          model: state.models[state.modelIndex] ?? "",
        },
      },
    },
  };
}

export function SettingsWizard({ initialSettings, onSubmit }: SettingsWizardProps) {
  const [state, setState] = useState<WizardState>(() => getInitialState(initialSettings));

  // Fetch models when entering fetching-models phase
  useEffect(() => {
    if (state.phase !== "fetching-models") return;
    const provider = getProviderById(state.providerId);
    if (!provider) {
      setState((s) => ({ ...s, phase: "error", error: "Unknown provider" }));
      return;
    }

    let cancelled = false;
    provider
      .listModels(state.baseUrl, state.apiKey)
      .then((models) => {
        if (cancelled) return;
        if (models.length === 0) {
          setState((s) => ({
            ...s,
            phase: "error",
            error: "No models found for this provider.",
          }));
          return;
        }
        setState((s) => ({
          ...s,
          phase: "select-model",
          models,
          modelIndex: 0,
          error: null,
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({
          ...s,
          phase: "error",
          error: `Failed to list models: ${message}`,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [state.phase, state.providerId, state.baseUrl, state.apiKey]);

  function goBack() {
    const p = getProviderById(state.providerId);
    switch (state.phase) {
      case "enter-baseurl":
        setState((s) => ({ ...s, phase: "select-provider", error: null }));
        break;
      case "enter-apikey":
        setState((s) => ({
          ...s,
          phase: p?.allowCustomBaseUrl ? "enter-baseurl" : "select-provider",
          error: null,
        }));
        break;
      case "fetching-models":
        setState((s) => ({
          ...s,
          phase: p?.requiresApiKey
            ? "enter-apikey"
            : p?.allowCustomBaseUrl
              ? "enter-baseurl"
              : "select-provider",
          error: null,
        }));
        break;
      case "select-model":
        setState((s) => ({
          ...s,
          phase: p?.requiresApiKey
            ? "enter-apikey"
            : p?.allowCustomBaseUrl
              ? "enter-baseurl"
              : "select-provider",
          error: null,
        }));
        break;
      case "review":
        setState((s) => ({ ...s, phase: "select-model", error: null }));
        break;
      case "error":
        setState((s) => ({ ...s, phase: "select-provider", error: null }));
        break;
      default:
        break;
    }
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    if (key.escape) {
      goBack();
      return;
    }

    // Error phase
    if (state.phase === "error") {
      if (key.return && state.error?.startsWith("Failed to list models")) {
        setState((s) => ({ ...s, phase: "fetching-models", error: null }));
      } else {
        setState((s) => ({ ...s, phase: "select-provider", error: null }));
      }
      return;
    }

    if (state.phase === "select-provider") {
      if (key.upArrow) {
        setState((s) => ({
          ...s,
          providerIndex: Math.max(0, s.providerIndex - 1),
        }));
      }
      if (key.downArrow) {
        setState((s) => ({
          ...s,
          providerIndex: Math.min(ALL_PROVIDERS.length - 1, s.providerIndex + 1),
        }));
      }
      if (key.return) {
        const provider = ALL_PROVIDERS[state.providerIndex];
        if (!provider) return;
        const next: Partial<WizardState> = {
          providerId: provider.id,
          baseUrl: provider.defaultBaseUrl,
          error: null,
        };
        if (provider.allowCustomBaseUrl) {
          setState((s) => ({ ...s, ...next, phase: "enter-baseurl" }));
        } else if (provider.requiresApiKey) {
          setState((s) => ({ ...s, ...next, phase: "enter-apikey" }));
        } else {
          setState((s) => ({ ...s, ...next, phase: "fetching-models" }));
        }
      }
      return;
    }

    if (state.phase === "select-model") {
      if (key.upArrow) {
        setState((s) => ({ ...s, modelIndex: Math.max(0, s.modelIndex - 1) }));
      }
      if (key.downArrow) {
        setState((s) => ({
          ...s,
          modelIndex: Math.min(s.models.length - 1, s.modelIndex + 1),
        }));
      }
      if (key.return) {
        setState((s) => ({ ...s, phase: "review" }));
      }
      return;
    }

    if (state.phase === "review") {
      if (key.backspace || key.delete) {
        setState((s) => ({ ...s, phase: "select-model" }));
      }
      if (key.return) {
        onSubmit(buildSettings(state));
      }
      return;
    }
  });

  const provider = getProviderById(state.providerId);
  const spinner = useSpinner(state.phase === "fetching-models");

  function handleFieldSubmit(value: string) {
    const trimmed = value.trim();
    if (state.phase === "enter-baseurl") {
      if (!trimmed) {
        setState((s) => ({ ...s, error: "Base URL is required." }));
        return;
      }
      setState((s) => ({
        ...s,
        baseUrl: trimmed,
        error: null,
        phase: provider?.requiresApiKey ? "enter-apikey" : "fetching-models",
      }));
    } else if (state.phase === "enter-apikey") {
      setState((s) => ({
        ...s,
        apiKey: trimmed,
        error: null,
        phase: "fetching-models",
      }));
    }
  }

  function handleFieldChange(value: string) {
    setState((s) => ({
      ...s,
      error: null,
      [s.phase === "enter-baseurl" ? "baseUrl" : "apiKey"]: value,
    }));
  }

  const localProviders = ALL_PROVIDERS.filter((p) => p.category === "local");
  const cloudProviders = ALL_PROVIDERS.filter((p) => p.category === "cloud");

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{"chorus setup"}</Text>
        <Text color="grey" dimColor>{"  · select provider and model"}</Text>
      </Box>

      {/* Phase title */}
      {state.phase === "select-provider" && <Text>{"Select a provider"}</Text>}
      {state.phase === "enter-baseurl" && (
        <Text>{`Base URL for ${provider?.label}`}</Text>
      )}
      {state.phase === "enter-apikey" && (
        <Text>{`${provider?.apiKeyLabel ?? "API key"}`}</Text>
      )}
      {state.phase === "fetching-models" && (
        <Text>{`Fetching models from ${provider?.label}…`}</Text>
      )}
      {state.phase === "select-model" && (
        <Text>{`Select a model (${state.models.length} available)`}</Text>
      )}
      {state.phase === "review" && <Text>{"Review and save"}</Text>}
      {state.phase === "error" && <Text color="red">{"Error"}</Text>}

      {/* Hint */}
      {state.phase === "select-provider" && (
        <Text color="grey" dimColor>{"[↑↓] navigate  [Enter] select"}</Text>
      )}
      {(state.phase === "enter-baseurl" || state.phase === "enter-apikey") && (
        <Text color="grey" dimColor>{"[Enter] confirm  [Esc] back"}</Text>
      )}
      {state.phase === "fetching-models" && (
        <Text color="grey" dimColor>{"[Esc] cancel"}</Text>
      )}
      {state.phase === "select-model" && (
        <Text color="grey" dimColor>{"[↑↓] navigate  [Enter] confirm  [Esc] back"}</Text>
      )}
      {state.phase === "review" && (
        <Text color="grey" dimColor>{"[Enter] save  [Backspace] go back  [Esc] back"}</Text>
      )}
      {state.phase === "error" && (
        <Text color="grey" dimColor>{"[Enter] retry  [Esc] start over"}</Text>
      )}

      {/* Content */}
      <Box flexDirection="column" marginTop={1}>
        {state.phase === "select-provider" && (
          <>
            <Text color="yellow" bold>{"Local"}</Text>
            {localProviders.map((p) => {
              const globalIndex = ALL_PROVIDERS.findIndex((ap) => ap.id === p.id);
              const selected = globalIndex === state.providerIndex;
              return (
                <Text key={p.id} color={selected ? "cyan" : "white"} bold={selected}>
                  {selected ? "▶ " : "  "}
                  {p.label}
                </Text>
              );
            })}
            <Box marginTop={1}>
              <Text color="yellow" bold>{"Cloud"}</Text>
            </Box>
            {cloudProviders.map((p) => {
              const globalIndex = ALL_PROVIDERS.findIndex((ap) => ap.id === p.id);
              const selected = globalIndex === state.providerIndex;
              return (
                <Text key={p.id} color={selected ? "cyan" : "white"} bold={selected}>
                  {selected ? "▶ " : "  "}
                  {p.label}
                </Text>
              );
            })}
          </>
        )}

        {(state.phase === "enter-baseurl" || state.phase === "enter-apikey") && (
          <Box flexDirection="row">
            <Text color="cyan" bold>{"> "}</Text>
            <TextInput
              value={state.phase === "enter-baseurl" ? state.baseUrl : state.apiKey}
              onChange={handleFieldChange}
              onSubmit={handleFieldSubmit}
              focus
              mask={state.phase === "enter-apikey" ? "•" : undefined}
            />
          </Box>
        )}

        {state.phase === "fetching-models" && (
          <Text>
            <Text color="cyan">{spinner}</Text>
            {" contacting API…"}
          </Text>
        )}

        {state.phase === "select-model" && (
          <Box flexDirection="column">
            {state.models.map((m, i) => {
              const selected = i === state.modelIndex;
              return (
                <Text key={m} color={selected ? "cyan" : "white"} bold={selected}>
                  {selected ? "▶ " : "  "}
                  {m}
                </Text>
              );
            })}
          </Box>
        )}

        {state.phase === "review" && (
          <Box flexDirection="column">
            <Text>{`Provider: ${provider?.label}`}</Text>
            {provider?.allowCustomBaseUrl ? (
              <Text>{`Base URL: ${state.baseUrl}`}</Text>
            ) : null}
            {provider?.requiresApiKey ? (
              <Text>{`API Key:  ${maskKey(state.apiKey)}`}</Text>
            ) : null}
            <Text>{`Model:    ${state.models[state.modelIndex] ?? ""}`}</Text>
          </Box>
        )}

        {state.phase === "error" && <Text color="red">{state.error}</Text>}
      </Box>
    </Box>
  );
}
