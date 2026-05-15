import { useReducer, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { globSync } from "glob";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { Feed } from "./components/Feed.js";
import { InputBox } from "./components/InputBox.js";
import { StatusBar, type AgentState } from "./components/StatusBar.js";
import { SuggestionBox, type Suggestion } from "./components/SuggestionBox.js";
import { SelectBox, type SelectItem } from "./components/SelectBox.js";
import { SessionView } from "./components/SessionView.js";
import { WelcomeScreen } from "./components/WelcomeScreen.js";
import { feedReducer, initialFeedState } from "./state/feedReducer.js";
import { countTokens } from "../context/tokenizer.js";
import { useAgentStream } from "./hooks/useAgentStream.js";
import { handleSlashCommand, SLASH_COMMANDS } from "./commands.js";
import { getProviderLabel, getProviderModel, getContextWindow, normalizeProviderName, resetDefaultProvider, getDefaultProvider } from "../llm/index.js";
import { sessionManager } from "../session/manager.js";
import { SettingsWizard } from "../settings/wizard.js";
import { ConfigWizard } from "../settings/configWizard.js";
import { loadSettings, saveSettings, clearSettingsCache } from "../settings/storage.js";
import { ALL_PROVIDERS, getProviderById } from "../settings/providers.js";
import type { ChorusSettings } from "../settings/storage.js";
import type { AgentSession } from "./state/feedReducer.js";
import type { AgentDef } from "../agents/types.js";
import type { ApprovalPolicy, ExecutionMode } from "../harness/types.js";
import { loadAgents } from "../agents/loader.js";
import { deleteAgent } from "../agents/storage.js";
import { AgentCreator } from "./components/AgentCreator.js";
import { AgentViewer } from "./components/AgentViewer.js";
import { ApprovalCard } from "./components/ApprovalCard.js";
import { McpServerWizard } from "./components/McpServerWizard.js";
import { McpDashboard } from "./components/McpDashboard.js";
import { AgentDashboard } from "./components/AgentDashboard.js";
import { BtwSidePanel, type BtwMessage } from "./components/BtwSidePanel.js";
import { runSwarm } from "../swarm/orchestrator.js";
import { buildPresetSwarm } from "../swarm/presets/index.js";
import { createProvider } from "../llm/registry.js";
import { buildSwarmReport, formatSwarmReport } from "../swarm/report.js";

type SelectionMode = {
  title: string;
  items: SelectItem[];
  onSelect: (value: string) => void;
} | null;

const WORKSPACE = process.cwd();

function loadWorkspaceFiles(): string[] {
  try {
    return globSync("**/*", {
      cwd: WORKSPACE,
      nodir: true,
      ignore: ["node_modules/**", ".git/**", "*.lock"],
      dot: true,
    });
  } catch {
    return [];
  }
}

const SECRET_PATTERNS = [/\.env(\.|$)/i, /credentials/i, /secret/i, /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /id_rsa/i, /id_ed25519/i];
const MAX_TOKENS_PER_MENTION = 4_000;
const TRUNCATED_HEAD_LINES = 60;
const TRUNCATED_TAIL_LINES = 40;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function isSecretFile(filePath: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(filePath));
}

function isBinaryContent(buf: Buffer): boolean {
  // Check first 8KB for null bytes — strong signal of binary
  const sample = buf.slice(0, 8192);
  return sample.includes(0);
}

function expandMentions(text: string, workspaceFiles: string[]): string {
  const mentionRe = /@([\w./\\-]+)/g;
  const matches = [...text.matchAll(mentionRe)];
  if (matches.length === 0) return text;

  const seen = new Set<string>();
  let result = "";
  let lastIndex = 0;

  for (const match of matches) {
    const mention = match[1];
    const mentionIndex = match.index ?? 0;
    const mentionText = match[0];

    // Append text between last match and this one
    result += text.slice(lastIndex, mentionIndex);
    lastIndex = mentionIndex + mentionText.length;

    if (seen.has(mention)) {
      // Already expanded this mention earlier — keep the @reference but skip re-inlining
      result += mentionText;
      continue;
    }
    seen.add(mention);

    // 1) Try exact / partial file match
    const foundFile = workspaceFiles.find(
      (f) => f === mention || f.endsWith(`/${mention}`) || path.basename(f) === mention
    );

    // 2) Try folder match
    const isFolderQuery = mention.endsWith("/");
    const folderPrefix = isFolderQuery ? mention : `${mention}/`;
    const foundFolderFiles = !foundFile
      ? workspaceFiles.filter((f) => f.startsWith(folderPrefix))
      : [];

    if (!foundFile && foundFolderFiles.length === 0) {
      result += mentionText;
      continue;
    }

    // Folder mention → list files, never inline content
    if (!foundFile && foundFolderFiles.length > 0) {
      const listing = foundFolderFiles.slice(0, 50).join("\n");
      const more = foundFolderFiles.length > 50
        ? `\n... and ${foundFolderFiles.length - 50} more files`
        : "";
      result += `@${mention}\n\n[Folder: ${mention}]\n${listing}${more}`;
      continue;
    }

    if (!foundFile) {
      result += mentionText;
      continue;
    }

    // File mention
    if (isSecretFile(foundFile)) {
      result += `@[${foundFile} — secret file skipped]`;
      continue;
    }

    const absPath = path.join(WORKSPACE, foundFile);
    try {
      const stats = fs.statSync(absPath);
      if (!stats.isFile()) {
        result += mentionText;
        continue;
      }
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        result += `@[${foundFile} — file too large (${(stats.size / 1024 / 1024).toFixed(1)} MB), skipped]`;
        continue;
      }

      const raw = fs.readFileSync(absPath);
      if (isBinaryContent(raw)) {
        result += `@[${foundFile} — binary file, skipped]`;
        continue;
      }

      const content = raw.toString("utf-8");
      const lines = content.split("\n");
      const totalTokens = countTokens(content);
      const ext = path.extname(foundFile).slice(1) || "text";

      let displayContent: string;
      let truncatedBadge = "";

      if (totalTokens <= MAX_TOKENS_PER_MENTION) {
        displayContent = content;
      } else {
        const head = lines.slice(0, TRUNCATED_HEAD_LINES).join("\n");
        const tail = lines.slice(-TRUNCATED_TAIL_LINES).join("\n");
        const omitted = lines.length - TRUNCATED_HEAD_LINES - TRUNCATED_TAIL_LINES;
        truncatedBadge = ` · truncated (${omitted} lines omitted)`;
        displayContent = `${head}\n\n[... ${omitted} lines omitted · ${totalTokens.toLocaleString()} tokens total · use read_file tool to view full content ...]\n\n${tail}`;
      }

      result += `@${foundFile}\n\n[File: ${foundFile} · ${lines.length} lines · ${totalTokens.toLocaleString()} tokens${truncatedBadge}]\n\`\`\`${ext}\n${displayContent}\n\`\`\``;
    } catch {
      result += mentionText;
    }
  }

  result += text.slice(lastIndex);
  return result;
}

export function App() {
  const { exit }              = useApp();
  const [feedState, dispatch] = useReducer(feedReducer, initialFeedState);
  const [tokens, setTokens]   = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [navFocusIndex, setNavFocusIndex] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [isPastePreviewed, setIsPastePreviewed] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [modelLabel, setModelLabel] = useState(getProviderLabel());
  const [sessionProvider, setSessionProvider] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("build");
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("auto_edit");
  const [advisorEnabled, setAdvisorEnabled] = useState<boolean>(() => loadSettings().llm?.advisor?.enabled ?? false);
  const [wizardMode, setWizardMode] = useState<"add-provider" | null>(null);
  const [showingApiKeysConfig, setShowingApiKeysConfig] = useState(false);
  const [agentCreatorOpen, setAgentCreatorOpen] = useState(false);
  const [agentEditorTarget, setAgentEditorTarget] = useState<AgentDef | null>(null);
  const [agentViewerTarget, setAgentViewerTarget] = useState<AgentDef | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(null);
  const [selectionIndex, setSelectionIndex] = useState(0);
  const [sessionViewId, setSessionViewId] = useState<string | null>(null);
  const [mcpWizardOpen, setMcpWizardOpen] = useState(false);
  const [mcpDashboardOpen, setMcpDashboardOpen] = useState(false);
  const [agentDashboardOpen, setAgentDashboardOpen] = useState(false);
  const [agentAiMode, setAgentAiMode] = useState(false);
  const [btwMessages, setBtwMessages] = useState<BtwMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  const showModelSelectForProvider = useCallback((provider: string) => {
    const ps = loadSettings().llm?.providers?.[provider] ?? {};
    const providerDef = getProviderById(provider);
    setSelectionMode({
      title: `Select model  [${provider}]  loading…`,
      items: [],
      onSelect: (model) => {
        setSessionProvider(provider);
        setSessionModel(model);
        setSelectionMode(null);
        dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Switched to ${provider}:${model} (session only)` });
      },
    });
    setSelectionIndex(0);
    void (providerDef?.listModels(ps.baseUrl ?? "", ps.apiKey ?? "") ?? Promise.resolve([]))
      .then((models) => {
        setSelectionMode((prev) =>
          prev ? { ...prev, title: `Select model  [${provider}]`, items: models.map((m) => ({ value: m, label: m })) } : null
        );
        setSelectionIndex(0);
      })
      .catch(() => {
        setSelectionMode(null);
        dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Could not load models for ${provider}.` });
      });
  }, [dispatch]);

  const showProviderSelect = useCallback((currentProvider: string) => {
    setSelectionMode({
      title: "Select provider",
      items: ALL_PROVIDERS.map((p) => ({ value: p.id, label: `${p.id.padEnd(12)}  ${p.label}` })),
      onSelect: (provider) => {
        setSessionProvider(provider);
        setSessionModel(null);
        showModelSelectForProvider(provider);
      },
    });
    setSelectionIndex(Math.max(0, ALL_PROVIDERS.findIndex((p) => p.id === currentProvider)));
  }, [showModelSelectForProvider]);

  const showDefaultModelSelectForProvider = useCallback((provider: string) => {
    const ps = loadSettings().llm?.providers?.[provider] ?? {};
    const providerDef = getProviderById(provider);
    setSelectionMode({
      title: `Set default model  [${provider}]  loading…`,
      items: [],
      onSelect: (model) => {
        try {
          const existing = loadSettings();
          saveSettings({
            ...existing,
            llm: {
              ...existing.llm,
              provider,
              providers: {
                ...existing.llm?.providers,
                [provider]: { ...existing.llm?.providers?.[provider], model },
              },
            },
          });
          clearSettingsCache();
          resetDefaultProvider();
          // Clear session overrides so the new default takes effect immediately
          setSessionProvider(null);
          setSessionModel(null);
          setModelLabel(getProviderLabel());
          setSelectionMode(null);
          dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Default saved: ${provider}:${model}` });
        } catch (err) {
          setSelectionMode(null);
          dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Failed to save settings: ${err instanceof Error ? err.message : String(err)}` });
        }
      },
    });
    setSelectionIndex(0);
    void (providerDef?.listModels(ps.baseUrl ?? "", ps.apiKey ?? "") ?? Promise.resolve([]))
      .then((models) => {
        setSelectionMode((prev) =>
          prev ? { ...prev, title: `Set default model  [${provider}]`, items: models.map((m) => ({ value: m, label: m })) } : null
        );
        setSelectionIndex(0);
      })
      .catch(() => {
        setSelectionMode(null);
        dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Could not load models for ${provider}.` });
      });
  }, [dispatch]);

  const showDefaultProviderSelect = useCallback(() => {
    const currentDefault = loadSettings().llm?.provider ?? "";
    setSelectionMode({
      title: "Set default provider",
      items: ALL_PROVIDERS.map((p) => ({ value: p.id, label: `${p.id.padEnd(12)}  ${p.label}` })),
      onSelect: (provider) => showDefaultModelSelectForProvider(provider),
    });
    setSelectionIndex(Math.max(0, ALL_PROVIDERS.findIndex((p) => p.id === currentDefault)));
  }, [showDefaultModelSelectForProvider]);

  const showResumeSelect = useCallback(() => {
    const sessions = sessionManager.listForWorkspace();
    if (sessions.length === 0) {
      dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: "No sessions found for this workspace." });
      return;
    }
    function timeAgo(ms: number): string {
      const secs = Math.floor((Date.now() - ms) / 1000);
      if (secs < 60) return `${secs}s ago`;
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    }
    setSelectionMode({
      title: "Resume session",
      items: sessions.map((s) => ({
        value: s.id,
        label: `${(s.name || "(unnamed)").slice(0, 28).padEnd(28)}  ${String(s.messageCount).padStart(3)} msg  ${timeAgo(s.updatedAt).padStart(8)}  ${s.id.slice(0, 8)}`,
      })),
      onSelect: (sessionId) => {
        setSelectionMode(null);
        resumeSessionRef.current(sessionId);
      },
    });
    setSelectionIndex(0);
  }, [dispatch]);

  const showAgents = useCallback(() => {
    setAgentDashboardOpen(true);
  }, []);

  const contextWindow = useMemo(() => {
    const provider = sessionProvider ?? modelLabel.split(":")[0] ?? "deepseek";
    const model = sessionModel ?? (modelLabel.split(":").slice(1).join(":") || getProviderModel(normalizeProviderName(provider) ?? "deepseek"));
    return getContextWindow(model, provider);
  }, [sessionProvider, sessionModel, modelLabel]);
  const prevLenRef = useRef(0);
  const tokensRef = useRef(0);
  const workspaceFiles = useRef<string[]>([]);

  useEffect(() => {
    workspaceFiles.current = loadWorkspaceFiles();
  }, []);

  useEffect(() => {
    void getDefaultProvider().then((provider) => {
      setModelLabel(`${provider.name}:${getProviderModel(provider.name)}`);
    });
  }, []);

  useEffect(() => { tokensRef.current = tokens; }, [tokens]);

  const modeInitialized = useRef(false);
  // Auto-switch to mode-specific model when execution mode changes
  useEffect(() => {
    const modeConfig = loadSettings().llm?.modes?.[executionMode];
    if (modeConfig) {
      setSessionProvider(modeConfig.provider);
      setSessionModel(modeConfig.model);
      if (modeInitialized.current) {
        dispatch({
          type: "APPEND_SYSTEM",
          id: `mode-model-${Date.now()}`,
          text: `${executionMode.toUpperCase()} mode → ${modeConfig.provider}:${modeConfig.model}`,
        });
      }
    }
    modeInitialized.current = true;
  }, [executionMode]);

  const displayLabel = useMemo(() => {
    if (sessionProvider && sessionModel) return `${sessionProvider}:${sessionModel}`;
    if (sessionProvider) return `${sessionProvider}:${getProviderModel(normalizeProviderName(sessionProvider) ?? "deepseek")}`;
    if (sessionModel) return `${modelLabel.split(":")[0]}:${sessionModel}`;
    return modelLabel;
  }, [sessionProvider, sessionModel, modelLabel]);


  const lastTurn = useMemo(() => {
    for (let i = feedState.entries.length - 1; i >= 0; i--) {
      const e = feedState.entries[i];
      if (e.kind === "turn") return e;
    }
    return null;
  }, [feedState.entries]);

  const expandableIds = useMemo(() => {
    if (!lastTurn || lastTurn.kind !== "turn") return [];
    const ids: string[] = [];
    for (const ev of lastTurn.events) {
      if (ev.kind === "tool" && ev.card.status !== "running") ids.push(ev.card.id);
    }
    for (const ev of lastTurn.events) {
      if (ev.kind === "thinking" && ev.text) ids.push(ev.id);
    }
    for (const ev of lastTurn.events) {
      if (ev.kind === "worker" && ev.card.status !== "running") ids.push(ev.card.id);
    }
    for (const ev of lastTurn.events) {
      if (ev.kind === "subagent" && ev.card.sessionId) ids.push(ev.card.id);
    }
    return ids;
  }, [lastTurn]);

  useEffect(() => {
    setNavFocusIndex(0);
  }, [lastTurn?.id]);

  const safeFocusIndex = Math.min(navFocusIndex, Math.max(0, expandableIds.length - 1));
  const focusedId      = expandableIds[safeFocusIndex] ?? null;

  // Get the focused event to check if it's a navigable session
  const focusedEvent = useMemo(() => {
    if (!lastTurn || lastTurn.kind !== "turn" || !focusedId) return null;
    for (const ev of lastTurn.events) {
      if ((ev.kind === "worker" || ev.kind === "subagent") && ev.card.id === focusedId) {
        return ev;
      }
    }
    return null;
  }, [lastTurn, focusedId]);

  const slashSuggestions = useMemo((): Suggestion[] => {
    if (!inputValue.startsWith("/")) return [];
    const partial = inputValue.toLowerCase();
    return SLASH_COMMANDS
      .filter((c) => c.name.startsWith(partial))
      .map((c) => ({ label: c.name, description: c.description }));
  }, [inputValue]);

  const mentionSuggestions = useMemo((): Suggestion[] => {
    const atMatch = inputValue.match(/@([\w./\\-]*)$/);
    if (!atMatch) return [];
    const partial = atMatch[1].toLowerCase();

    const allAgents = loadAgents();
    const matchingAgents = allAgents
      .filter((a) => a.name.toLowerCase().startsWith(partial))
      .map((a) => ({
        label: a.name,
        description: `agent — ${a.description || "custom agent"}`,
      }));

    const files = workspaceFiles.current
      .filter((f) => f.toLowerCase().includes(partial))
      .slice(0, partial.length === 0 ? 3 : 6)
      .map((f) => ({ label: f }));

    return [...matchingAgents, ...files].slice(0, 12);
  }, [inputValue]);

  const activeSuggestions =
    slashSuggestions.length > 0 ? slashSuggestions :
    mentionSuggestions.length > 0 ? mentionSuggestions : [];

  useEffect(() => {
    setSuggestionIndex(activeSuggestions.length > 0 ? 0 : -1);
  }, [activeSuggestions.length]);

  const currentSession = sessionManager.getCurrent();

  const { submit, submitBtw, clearHistory, loadSession, getMessages, pendingApproval, respondToApproval } = useAgentStream({
    dispatch,
    onTokensUpdate: setTokens,
    initialMessages: currentSession?.messages,
    providerName: sessionProvider ?? undefined,
    modelName: sessionModel ?? undefined,
    executionMode,
    approvalPolicy,
  });

  // Use refs to avoid stale closures in the global input handler
  const pendingApprovalRef = useRef(pendingApproval);
  const respondToApprovalRef = useRef(respondToApproval);
  pendingApprovalRef.current = pendingApproval;
  respondToApprovalRef.current = respondToApproval;

  // Auto-process queued messages when agent finishes current turn
  const prevProcessingRef = useRef(feedState.processing);
  useEffect(() => {
    const wasProcessing = prevProcessingRef.current;
    prevProcessingRef.current = feedState.processing;
    if (wasProcessing && !feedState.processing && queuedMessages.length > 0) {
      const next = queuedMessages[0];
      setQueuedMessages((prev) => prev.slice(1));
      dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Processing queued message (${queuedMessages.length - 1} remaining)...` });
      void (async () => {
        const expanded = expandMentions(next, workspaceFiles.current);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          await submit(expanded, controller.signal);
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      })();
    }
  }, [feedState.processing, queuedMessages.length, dispatch, submit]);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();

    if (pendingApprovalRef.current) {
      const input = _input.toLowerCase();
      if (input === "a") {
        void respondToApprovalRef.current("approve");
        return;
      }
      if (input === "s") {
        void respondToApprovalRef.current("approve_session");
        return;
      }
      if (input === "d" || key.escape) {
        void respondToApprovalRef.current("deny");
        return;
      }
      return;
    }

    // Session view mode: Esc or q exits
    if (sessionViewId) {
      if (key.escape || _input === "q") {
        setSessionViewId(null);
        return;
      }
      return;
    }

    // Selection mode intercepts all navigation and confirm/cancel
    if (selectionMode) {
      if (key.escape) {
        setSelectionMode(null);
        setInputValue("");
        setSuggestionIndex(-1);
        return;
      }
      if (key.upArrow) {
        if (selectionMode.items.length > 0)
          setSelectionIndex((i) => i <= 0 ? selectionMode.items.length - 1 : i - 1);
        return;
      }
      if (key.downArrow) {
        if (selectionMode.items.length > 0)
          setSelectionIndex((i) => (i + 1) % selectionMode.items.length);
        return;
      }
      if (key.return) {
        const item = selectionMode.items[selectionIndex];
        if (item) selectionMode.onSelect(item.value);
        return;
      }
      return;
    }

    if (key.escape) {
      if (feedState.processing && abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: "Agent interrupted by user." });
        return;
      }
      if (activeSuggestions.length > 0 || suggestionIndex >= 0) {
        setSuggestionIndex(-1);
        return;
      }
      setInputValue("");
      setSuggestionIndex(-1);
      return;
    }

    if (key.upArrow) {
      if (activeSuggestions.length > 0) {
        setSuggestionIndex((i) =>
          i <= 0 ? activeSuggestions.length - 1 : i - 1
        );
        return;
      }
    }

    if (key.downArrow) {
      if (activeSuggestions.length > 0) {
        setSuggestionIndex((i) =>
          i < 0 ? 0 : (i + 1) % activeSuggestions.length
        );
        return;
      }
    }

    // Shift+Tab toggles execution mode (build ↔ plan)
    if (key.shift && key.tab) {
      const nextMode = executionMode === "build" ? "plan" : "build";
      setExecutionMode(nextMode);
      dispatch({
        type: "APPEND_SYSTEM",
        id: `mode-${Date.now()}`,
        text: `Switched to ${nextMode.toUpperCase()} mode`,
      });
      return;
    }

    if (key.tab) {
      // Tab on empty input = cycle focus, not autocomplete
      if (inputValue === "" && expandableIds.length > 0) {
        setNavFocusIndex((i) => (i + 1) % expandableIds.length);
        return;
      }
      if (activeSuggestions.length > 0) {
        const selected = activeSuggestions[suggestionIndex < 0 ? 0 : suggestionIndex];
        if (slashSuggestions.length > 0) {
          setInputValue(selected.label + " ");
        } else {
          setInputValue((v) => v.replace(/@([\w./\\-]*)$/, `@${selected.label} `));
        }
        setSuggestionIndex(-1);
        setInputKey((k) => k + 1);
        return;
      }
      if (expandableIds.length > 0) {
        setNavFocusIndex((i) => (i + 1) % expandableIds.length);
      }
      return;
    }

    if (_input === " " && inputValue === "" && focusedId !== null) {
      dispatch({ type: "TOGGLE_EXPANDED", id: focusedId });
      return;
    }

    if (key.return) {
      if (isPastePreviewed && inputValue.trim() && !feedState.processing) {
        void handleSubmit(inputValue);
        return;
      }
      if (focusedEvent && inputValue === "") {
        const sessionId = focusedEvent.card.sessionId;
        if (sessionId) setSessionViewId(sessionId);
        return;
      }
    }
  });

  function handleInputChange(val: string) {
    if (val.includes("\t")) return;
    // Space on empty input with a focused item = toggle expand, not typing
    if (val === " " && inputValue === "" && focusedId !== null) return;

    const delta = val.length - prevLenRef.current;
    if (delta > 30) setIsPastePreviewed(true);
    if (val.length < prevLenRef.current) setIsPastePreviewed(false);
    prevLenRef.current = val.length;

    setInputValue(val);
    setSuggestionIndex(activeSuggestions.length > 0 ? 0 : -1);
  }

  useEffect(() => {
    if (currentSession && currentSession.messages.length > 0) {
      const name = currentSession.name || "(unnamed)";
      dispatch({
        type: "APPEND_SYSTEM",
        id:   `resume-banner-${Date.now()}`,
        text: `Resumed: ${name} · ${currentSession.messages.length} messages in context`,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onResumeSession = useCallback(
    (id: string) => {
      const msgs = sessionManager.resumeSession(id);
      if (!msgs) {
        dispatch({ type: "APPEND_SYSTEM", id: `err-${Date.now()}`, text: "Session not found." });
        return;
      }
      loadSession(msgs as Array<{ role: string; content: string; reasoning_content?: string }>);
      dispatch({ type: "LOAD_HISTORY", messages: msgs });
      const sess = sessionManager.getCurrent();
      const name = sess?.name || "(unnamed)";
      dispatch({
        type: "APPEND_SYSTEM",
        id:   `resumed-${Date.now()}`,
        text: `↩ Resumed: ${name}`,
      });
    },
    [loadSession, dispatch],
  );

  const resumeSessionRef = useRef(onResumeSession);
  useEffect(() => { resumeSessionRef.current = onResumeSession; }, [onResumeSession]);

  const swarmGenRef = useRef<AsyncGenerator<import("../swarm/types.js").SwarmEvent> | null>(null);
  const stopSwarm = useCallback(() => {
    if (swarmGenRef.current) {
      void swarmGenRef.current.return(undefined as never);
      swarmGenRef.current = null;
    }
  }, []);

  const listSwarmTraces = useCallback(() => {
    const tracesDir = path.join(
      process.env.CHORUS_HOME_DIR ?? path.join(process.env.HOME ?? "~", ".chorus"),
      "swarm-traces",
    );
    try {
      const files = fs.readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));
      if (files.length === 0) {
        dispatch({ type: "APPEND_SYSTEM", id: `traces-${Date.now()}`, text: "No swarm traces found." });
      } else {
        const rows = files.map((f) => {
          try {
            const stat = fs.statSync(path.join(tracesDir, f));
            const kb = (stat.size / 1024).toFixed(1);
            return `  ${f.replace(".jsonl", "")}  ${kb}KB`;
          } catch {
            return `  ${f}`;
          }
        });
        dispatch({ type: "APPEND_SYSTEM", id: `traces-${Date.now()}`, text: `Swarm traces:\n${rows.join("\n")}` });
      }
    } catch {
      dispatch({ type: "APPEND_SYSTEM", id: `traces-${Date.now()}`, text: `No traces directory found at ${tracesDir}` });
    }
  }, [dispatch]);

  const showSwarmReport = useCallback((swarmId: string) => {
    const report = buildSwarmReport(swarmId);
    dispatch({
      type: "APPEND_SYSTEM",
      id: `swarm-report-${Date.now()}`,
      text: report ? formatSwarmReport(report) : `No trace found for swarm: ${swarmId}`,
    });
  }, [dispatch]);

  const showConfirmDialog = useCallback((message: string, onConfirm: () => void) => {
    setSelectionMode({
      title: message,
      items: [
        { value: "confirm", label: "Confirm" },
        { value: "cancel", label: "Cancel" },
      ],
      onSelect: (value) => {
        setSelectionMode(null);
        if (value === "confirm") onConfirm();
      },
    });
    setSelectionIndex(0);
  }, []);

  const showFilePicker = useCallback((onSelect: (filePath: string, content: string) => void) => {
    const files = workspaceFiles.current
      .filter((file) => !isSecretFile(file))
      .slice(0, 300)
      .map((file) => ({ value: file, label: file }));

    if (files.length === 0) {
      dispatch({ type: "APPEND_SYSTEM", id: `file-picker-${Date.now()}`, text: "No readable workspace files found." });
      return;
    }

    setSelectionMode({
      title: "Select file to add",
      items: files,
      onSelect: (filePath) => {
        setSelectionMode(null);
        try {
          const content = fs.readFileSync(path.join(WORKSPACE, filePath), "utf-8");
          onSelect(filePath, content);
        } catch (error) {
          dispatch({
            type: "APPEND_SYSTEM",
            id: `file-picker-${Date.now()}`,
            text: `Could not read file: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      },
    });
    setSelectionIndex(0);
  }, [dispatch]);

  const runShellStream = useCallback((command: string, args: string[], label: string) => {
    const startedAt = Date.now();
    const runId = `shell-${startedAt}`;
    const display = [command, ...args].join(" ");
    let output = "";
    let pending = "";
    let closed = false;

    const appendChunk = (force = false) => {
      if (!pending && !force) return;
      const chunk = pending;
      pending = "";
      if (!chunk) return;
      dispatch({
        type: "APPEND_SYSTEM",
        id: `${runId}-chunk-${Date.now()}`,
        text: `${label} output:\n\`\`\`\n${chunk.slice(-6000)}\n\`\`\``,
      });
    };

    try {
      const child = spawn(command, args, {
        cwd: WORKSPACE,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setInterval(() => appendChunk(), 1000);
      const collect = (chunk: Buffer) => {
        const text = chunk.toString();
        output += text;
        pending += text;
      };

      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (error) => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        dispatch({
          type: "APPEND_SYSTEM",
          id: `${runId}-error`,
          text: `${label} failed to start: ${error.message}`,
        });
      });
      child.on("close", (code) => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        appendChunk(true);
        const durationMs = Date.now() - startedAt;
        const cappedOutput = output.trim().slice(-20_000) || "[no output]";
        dispatch({
          type: "APPEND_SYSTEM",
          id: `${runId}-done`,
          text: `${label} finished (${display})\nExit: ${code ?? "unknown"}  Duration: ${(durationMs / 1000).toFixed(1)}s\n\`\`\`\n${cappedOutput}\n\`\`\``,
        });
      });
    } catch (error) {
      dispatch({
        type: "APPEND_SYSTEM",
        id: `${runId}-error`,
        text: `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [dispatch]);

  const runSwarmPreset = useCallback(
    (presetName: string, task: string) => {
      const rawProvider = sessionProvider ?? displayLabel.split(":")[0] ?? "ollama";
      const normalizedProvider = normalizeProviderName(rawProvider) ?? "ollama";
      const model = sessionModel ?? getProviderModel(normalizedProvider);
      void (async () => {
        let currentSwarmId = "";
        try {
          const provider = createProvider(normalizedProvider);
          const config = buildPresetSwarm(presetName, task, provider, model);
          const gen = runSwarm(config);
          swarmGenRef.current = gen;
          for await (const event of gen) {
            switch (event.type) {
              case "swarm-start":
                currentSwarmId = event.swarmId;
                dispatch({
                  type: "SWARM_START",
                  swarmId: event.swarmId,
                  presetName,
                  agents: event.agents,
                  startedAt: Date.now(),
                });
                break;
              case "agent-start":
                dispatch({
                  type: "SWARM_AGENT_START",
                  swarmId: currentSwarmId,
                  agentName: event.agent,
                  contextMode: event.contextMode,
                  startedAt: Date.now(),
                });
                break;
              case "token":
                if ("agent" in event) {
                  dispatch({
                    type: "SWARM_AGENT_TOKEN",
                    swarmId: currentSwarmId,
                    agentName: (event as { agent: string }).agent,
                    text: event.text,
                  });
                }
                break;
              case "tool-start":
                if ("agent" in event) {
                  const e = event as { agent: string; id: string; name: string; args: Record<string, unknown> };
                  dispatch({
                    type: "SWARM_TOOL_START",
                    swarmId: currentSwarmId,
                    agentName: e.agent,
                    toolCall: { id: e.id, name: e.name, args: e.args, status: "running" },
                  });
                }
                break;
              case "tool-done":
                if ("agent" in event) {
                  const e = event as { agent: string; id: string; name: string; result: string };
                  dispatch({
                    type: "SWARM_TOOL_DONE",
                    swarmId: currentSwarmId,
                    agentName: e.agent,
                    toolId: e.id,
                    result: e.result,
                    status: "done",
                  });
                }
                break;
              case "tool-error":
                if ("agent" in event) {
                  const e = event as { agent: string; id: string; error: string };
                  dispatch({
                    type: "SWARM_TOOL_DONE",
                    swarmId: currentSwarmId,
                    agentName: e.agent,
                    toolId: e.id,
                    result: e.error,
                    status: "error",
                  });
                }
                break;
              case "agent-done":
                dispatch({
                  type: "SWARM_AGENT_DONE",
                  swarmId: currentSwarmId,
                  agentName: event.agent,
                  completedAt: Date.now(),
                });
                break;
              case "handoff":
                dispatch({
                  type: "SWARM_HANDOFF",
                  swarmId: currentSwarmId,
                  from: event.from,
                  to: event.to,
                  taskDescription: event.taskDescription,
                  reasoning: event.reasoning,
                });
                break;
              case "artifact-set":
                dispatch({
                  type: "SWARM_ARTIFACT",
                  swarmId: currentSwarmId,
                  key: event.key,
                });
                break;
              case "validation-fail":
                dispatch({
                  type: "SWARM_VALIDATION_FAIL",
                  swarmId: currentSwarmId,
                  agentName: event.agent,
                  reason: event.reason,
                });
                break;
              case "circuit-break":
                dispatch({
                  type: "SWARM_CIRCUIT_BREAK",
                  swarmId: currentSwarmId,
                  agent: event.agent,
                  reason: event.reason,
                });
                break;
              case "swarm-done":
                dispatch({
                  type: "SWARM_DONE",
                  swarmId: event.swarmId,
                  handoffCount: event.handoffCount,
                  totalAgentRounds: event.totalAgentRounds,
                  completedAt: Date.now(),
                });
                break;
            }
          }
        } catch (err) {
          if (currentSwarmId) {
            dispatch({ type: "SWARM_ERROR", swarmId: currentSwarmId, message: String(err) });
          } else {
            dispatch({ type: "APPEND_SYSTEM", id: `swarm-err-${Date.now()}`,
              text: `Swarm error: ${err instanceof Error ? err.message : String(err)}` });
          }
        } finally {
          swarmGenRef.current = null;
        }
      })();
    },
    [dispatch, sessionProvider, sessionModel, displayLabel],
  );

  const sendAgentMessage = useCallback((message: string) => {
    const expanded = expandMentions(message, workspaceFiles.current);
    void submit(expanded);
  }, [submit]);

  const getSessionCost = useCallback(() => ({
    inputTokens: feedState.totalInputTokens,
    outputTokens: feedState.totalOutputTokens,
    costUsd: feedState.totalCost,
  }), [feedState.totalInputTokens, feedState.totalOutputTokens, feedState.totalCost]);

  const onNewSession = useCallback(() => {
    sessionManager.createSession();
    clearHistory();
    dispatch({ type: "CLEAR_FEED" });
    setSessionProvider(null);
    setSessionModel(null);
    setModelLabel(getProviderLabel());
  }, [clearHistory, dispatch]);

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // During processing, only allow /btw and /exit to keep the agent responsive
      if (feedState.processing) {
        if (trimmed === "/exit") {
          exit();
          return;
        }
        if (trimmed.startsWith("/btw")) {
          const btwText = trimmed.slice(4).trim();
          if (btwText) {
            const msgId = `btw-${Date.now()}`;
            const newMsg: BtwMessage = { id: msgId, question: btwText, loading: true };
            setBtwMessages((prev) => [...prev, newMsg]);

            // Run side-channel query asynchronously
            const currentMessages = getMessages();
            void (async () => {
              try {
                const { runBtwQuery } = await import("./agent/btwRuntime.js");
                const result = await runBtwQuery(btwText, currentMessages);
                setBtwMessages((prev) => prev.map((m) =>
                  m.id === msgId ? { ...m, response: result.response, loading: false } : m
                ));
              } catch (e) {
                setBtwMessages((prev) => prev.map((m) =>
                  m.id === msgId ? { ...m, error: e instanceof Error ? e.message : String(e), loading: false } : m
                ));
              }
            })();

            dispatch({
              type: "APPEND_SYSTEM",
              id: `sys-${Date.now()}`,
              text: `Side question queued. Response will appear in the side panel.`,
            });
          } else {
            dispatch({
              type: "APPEND_SYSTEM",
              id: `sys-${Date.now()}`,
              text: "Usage: /btw <your question for the side channel>",
            });
          }
          setInputValue("");
          return;
        }
        // Block other messages while processing — queue them instead
        if (queuedMessages.length === 0) {
          dispatch({
            type: "APPEND_SYSTEM",
            id: `sys-${Date.now()}`,
            text: "Agent is working — message queued. Will process when current task completes. Esc to interrupt.",
          });
        }
        setQueuedMessages((prev) => [...prev, trimmed]);
        setInputValue("");
        return;
      }

      if (suggestionIndex >= 0 && activeSuggestions.length > 0) {
        const selected = activeSuggestions[suggestionIndex];
        if (slashSuggestions.length > 0) {
          setInputValue(selected.label + " ");
        } else {
          setInputValue((v) => v.replace(/@([\w./\\-]*)$/, `@${selected.label} `));
        }
        setSuggestionIndex(-1);
        setInputKey((k) => k + 1);
        return;
      }

      setInputValue("");
      setSuggestionIndex(-1);
      setIsPastePreviewed(false);
      prevLenRef.current = 0;

      const handled = handleSlashCommand(trimmed, {
        dispatch,
        clearHistory,
        getTokens: () => tokensRef.current,
        getModel: () => displayLabel,
        exit,
        onResumeSession,
        onNewSession,
        launchWizard: (mode) => setWizardMode(mode),
        showModelSelect: () => {
          const provider = sessionProvider ?? displayLabel.split(":")[0];
          showModelSelectForProvider(provider);
        },
        showProviderSelect: () => {
          const provider = sessionProvider ?? displayLabel.split(":")[0];
          showProviderSelect(provider);
        },
        showResumeSelect,
        showDefaultModelSelect: showDefaultProviderSelect,
        showAgents,
        submitBtw,
        showApiKeysConfig: () => setShowingApiKeysConfig(true),
        showMcpAddWizard: () => setMcpWizardOpen(true),
          showMcpDashboard: () => setMcpDashboardOpen(true),
        runSwarmPreset,
        stopSwarm,
        listSwarmTraces,
        showSwarmReport,
        sendAgentMessage,
        runShellStream,
        showFilePicker,
        showConfirmDialog,
        getSessionCost,
        showModeModelSelect: (mode) => {
          const provider = sessionProvider ?? displayLabel.split(":")[0];
          setSelectionMode({
            title: `Select provider for ${mode.toUpperCase()} mode`,
            items: ALL_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
            onSelect: (selectedProvider) => {
              const ps = loadSettings().llm?.providers?.[selectedProvider] ?? {};
              const providerDef = getProviderById(selectedProvider);
              setSelectionMode({
                title: `Select model for ${mode.toUpperCase()} mode  [${selectedProvider}]`,
                items: [],
                onSelect: (selectedModel) => {
                  const settings = loadSettings();
                  const updated: ChorusSettings = {
                    ...settings,
                    llm: {
                      ...settings.llm,
                      modes: {
                        ...settings.llm?.modes,
                        [mode]: { provider: selectedProvider, model: selectedModel },
                      },
                    },
                  };
                  saveSettings(updated);
                  dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `${mode.toUpperCase()} mode → ${selectedProvider}:${selectedModel}` });
                  setSelectionMode(null);
                },
              });
              setSelectionIndex(0);
              void (providerDef?.listModels(ps.baseUrl ?? "", ps.apiKey ?? "") ?? Promise.resolve([]))
                .then((models) => {
                  setSelectionMode((prev) =>
                    prev ? { ...prev, items: models.map((m) => ({ value: m, label: m })) } : null
                  );
                })
                .catch(() => {
                  dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Could not load models for ${selectedProvider}.` });
                  setSelectionMode(null);
                });
            },
          });
          setSelectionIndex(0);
        },
        getExecutionMode: () => executionMode,
        setExecutionMode,
        getApprovalPolicy: () => approvalPolicy,
        setApprovalPolicy,
        setAdvisorEnabled: (enabled) => {
          const settings = loadSettings();
          const updated: ChorusSettings = {
            ...settings,
            llm: {
              ...settings.llm,
              advisor: { ...settings.llm?.advisor, enabled },
            },
          };
          saveSettings(updated);
          setAdvisorEnabled(enabled);
        },
      });
      if (handled) return;

      const expanded = expandMentions(trimmed, workspaceFiles.current);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await submit(expanded, controller.signal);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [submit, submitBtw, clearHistory, getMessages, feedState.processing, exit, dispatch, suggestionIndex, activeSuggestions, slashSuggestions, onResumeSession, onNewSession, displayLabel, sessionProvider, sessionModel, executionMode, approvalPolicy, advisorEnabled, showModelSelectForProvider, showProviderSelect, showResumeSelect, showDefaultProviderSelect, showAgents, showingApiKeysConfig, runSwarmPreset, stopSwarm, listSwarmTraces, showSwarmReport, sendAgentMessage, runShellStream, showFilePicker, showConfirmDialog, getSessionCost]
  );

  const agentState = useMemo<AgentState>(() => {
    if (!feedState.processing) return "idle";
    for (let i = feedState.entries.length - 1; i >= 0; i--) {
      const e = feedState.entries[i];
      if (e.kind === "turn" && !e.done) {
        const hasRunningTool = e.events.some(
          (ev) => ev.kind === "tool" && ev.card.status === "running"
        );
        return hasRunningTool ? "tool" : "thinking";
      }
    }
    return "thinking";
  }, [feedState.processing, feedState.entries]);

  // Session view mode
  if (sessionViewId) {
    const session = feedState.sessions[sessionViewId];
    if (session) {
      return (
        <Box flexDirection="column">
          <Box flexGrow={1}><SessionView session={session} onBack={() => setSessionViewId(null)} /></Box>
          <StatusBar
            modelLabel={displayLabel}
            tokens={tokens}
            agentState={agentState}
            sessionName={sessionManager.getCurrent()?.name}
            maxTokens={contextWindow}
          />
        </Box>
      );
    }
    setSessionViewId(null);
  }

  if (agentDashboardOpen) {
    return (
      <Box flexDirection="column">
        <Box flexGrow={1}>
        <AgentDashboard
          onDone={(msg) => {
            setAgentDashboardOpen(false);
            if (msg) dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: msg });
          }}
          onCancel={() => setAgentDashboardOpen(false)}
          onCreateNew={(mode) => {
            setAgentDashboardOpen(false);
            setAgentAiMode(mode === "ai");
            setAgentCreatorOpen(true);
          }}
          onEdit={(agent) => {
            setAgentDashboardOpen(false);
            setAgentEditorTarget(agent);
          }}
          onView={(agent) => {
            setAgentDashboardOpen(false);
            setAgentViewerTarget(agent);
          }}
          onUse={(agent) => {
            setAgentDashboardOpen(false);
            dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `Type @${agent.name} followed by your task to invoke this agent.` });
          }}
        />
        </Box>
        <StatusBar
          modelLabel={displayLabel}
          tokens={tokens}
          agentState="idle"
          sessionName={sessionManager.getCurrent()?.name}
          maxTokens={contextWindow}
        />
      </Box>
    );
  }

  if (agentCreatorOpen) {
    return (
      <Box flexDirection="column">
        <Box flexGrow={1}>
        <AgentCreator
          aiMode={agentAiMode}
          onDone={(msg) => {
            setAgentCreatorOpen(false);
            setAgentAiMode(false);
            dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: msg });
          }}
          onCancel={() => { setAgentCreatorOpen(false); setAgentAiMode(false); }}
        />
        </Box>
        <StatusBar
          modelLabel={displayLabel}
          tokens={tokens}
          agentState="idle"
          sessionName={sessionManager.getCurrent()?.name}
          maxTokens={contextWindow}
        />
      </Box>
    );
  }

  if (agentEditorTarget) {
    return (
      <Box flexDirection="column">
        <Box flexGrow={1}>
        <AgentCreator
          initialAgent={agentEditorTarget}
          onDone={(msg) => {
            setAgentEditorTarget(null);
            dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: msg });
          }}
          onCancel={() => setAgentEditorTarget(null)}
        />
        </Box>
        <StatusBar
          modelLabel={displayLabel}
          tokens={tokens}
          agentState="idle"
          sessionName={sessionManager.getCurrent()?.name}
          maxTokens={contextWindow}
        />
      </Box>
    );
  }

  if (agentViewerTarget) {
    return (
      <Box flexDirection="column">
        <Box flexGrow={1}><AgentViewer agent={agentViewerTarget} onBack={() => setAgentViewerTarget(null)} /></Box>
        <StatusBar
          modelLabel={displayLabel}
          tokens={tokens}
          agentState="idle"
          sessionName={sessionManager.getCurrent()?.name}
          maxTokens={contextWindow}
        />
      </Box>
    );
  }

  if (mcpDashboardOpen) {
    return (
      <Box flexDirection="column">
        <Box flexGrow={1}>
        <McpDashboard
          onDone={(msg) => {
            setMcpDashboardOpen(false);
            if (msg) dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: msg });
          }}
          onCancel={() => setMcpDashboardOpen(false)}
          onAuth={(serverName) => {
            setMcpDashboardOpen(false);
            void (async () => {
              try {
                const { loadMcpServers } = await import("../mcp/config.js");
                const { runOAuthFlow } = await import("../mcp/auth.js");
                const configs = loadMcpServers();
                const config = configs.find((c) => c.name === serverName);
                if (config) await runOAuthFlow(config);
                dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `OAuth authorized for "${serverName}". Run /mcp to reconnect.` });
              } catch (e) {
                dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: `OAuth failed: ${e instanceof Error ? e.message : String(e)}` });
              }
            })();
          }}
        />
        </Box>
        <StatusBar
          modelLabel={displayLabel}
          tokens={tokens}
          agentState="idle"
          sessionName={sessionManager.getCurrent()?.name}
          maxTokens={contextWindow}
        />
      </Box>
    );
  }

  if (mcpWizardOpen) {
    return (
      <Box flexDirection="column">
        <Box flexGrow={1}>
        <McpServerWizard
          onDone={(msg) => {
            setMcpWizardOpen(false);
            dispatch({ type: "APPEND_SYSTEM", id: `sys-${Date.now()}`, text: msg });
          }}
          onCancel={() => setMcpWizardOpen(false)}
        />
        </Box>
        <StatusBar
          modelLabel={displayLabel}
          tokens={tokens}
          agentState="idle"
          sessionName={sessionManager.getCurrent()?.name}
          maxTokens={contextWindow}
        />
      </Box>
    );
  }

  if (showingApiKeysConfig) {
    return (
      <ConfigWizard
        onDone={(saved) => {
          if (saved) {
            clearSettingsCache();
            resetDefaultProvider();
            setModelLabel(getProviderLabel());
          }
          setShowingApiKeysConfig(false);
          dispatch({
            type: "APPEND_SYSTEM",
            id: `config-${Date.now()}`,
            text: saved ? "Configuration saved to ~/.chorus/settings.json" : "Configuration cancelled.",
          });
        }}
      />
    );
  }

  if (wizardMode === "add-provider") {
    return (
      <SettingsWizard
        initialSettings={loadSettings()}
        onSubmit={(settings) => {
          const existing = loadSettings();
          const merged: ChorusSettings = {
            ...existing,
            llm: {
              ...existing.llm,
              provider: settings.llm?.provider ?? existing.llm?.provider,
              providers: {
                ...existing.llm?.providers,
                ...settings.llm?.providers,
              },
            },
          };
          saveSettings(merged);
          clearSettingsCache();
          resetDefaultProvider();
          setModelLabel(getProviderLabel());
          setWizardMode(null);
          dispatch({
            type: "APPEND_SYSTEM",
            id: `provider-added-${Date.now()}`,
            text: `Provider configured: ${settings.llm?.provider ?? "unknown"} · model ${settings.llm?.provider ? settings.llm.providers?.[settings.llm.provider]?.model ?? "unknown" : "unknown"}`,
          });
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {feedState.entries.length === 0 ? (
        <WelcomeScreen
          modelLabel={displayLabel}
          workspace={WORKSPACE}
          executionMode={executionMode}
          approvalPolicy={approvalPolicy}
        />
      ) : (
        <Feed
          entries={feedState.entries}
          processing={feedState.processing}
          onToggle={(id) => dispatch({ type: "TOGGLE_EXPANDED", id })}
          onToggleSwarmAgent={(swarmId, sectionId) =>
            dispatch({ type: "SWARM_TOGGLE_AGENT", swarmId, sectionId })
          }
          focusedId={focusedId}
        />
      )}
      {btwMessages.length > 0 && (
        <BtwSidePanel
          messages={btwMessages}
          onDismiss={() => setBtwMessages([])}
        />
      )}
      {pendingApproval ? (
        <ApprovalCard approval={pendingApproval} />
      ) : selectionMode ? (
        <SelectBox
          title={selectionMode.title}
          items={selectionMode.items}
          selectedIndex={selectionIndex}
        />
      ) : (
        <>
          {activeSuggestions.length > 0 && (
            <SuggestionBox
              suggestions={activeSuggestions}
              selectedIndex={suggestionIndex}
            />
          )}
          <InputBox
            value={inputValue}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            disabled={feedState.processing}
            isPastePreviewed={isPastePreviewed}
            onDismissPaste={() => setIsPastePreviewed(false)}
            resetKey={inputKey}
          />
        </>
      )}
      {queuedMessages.length > 0 && (
        <Box paddingLeft={1} paddingRight={1}>
          <Text color="yellow">{"◈ "}{queuedMessages.length}{" message"}{queuedMessages.length > 1 ? "s" : ""}{" queued — will process after current task"}</Text>
        </Box>
      )}
      <StatusBar
        modelLabel={displayLabel}
        tokens={tokens}
        agentState={agentState}
        sessionName={sessionManager.getCurrent()?.name}
        maxTokens={contextWindow}
        executionMode={executionMode}
        approvalPolicy={approvalPolicy}
      />
    </Box>
  );
}
