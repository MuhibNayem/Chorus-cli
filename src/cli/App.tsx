import { useReducer, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { globSync } from "glob";
import * as fs from "fs";
import * as path from "path";
import { Feed } from "./components/Feed.js";
import { InputBox } from "./components/InputBox.js";
import { StatusBar, type AgentState } from "./components/StatusBar.js";
import { SuggestionBox, type Suggestion } from "./components/SuggestionBox.js";
import { feedReducer, initialFeedState } from "./state/feedReducer.js";
import { useAgentStream } from "./hooks/useAgentStream.js";
import { handleSlashCommand, SLASH_COMMANDS } from "./commands.js";
import { sessionManager } from "../session/manager.js";

const WORKSPACE = process.cwd();
const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";

// Preload workspace file list once (excludes node_modules/.git)
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

// Expand @mention tokens to file content blocks
function expandMentions(text: string, workspaceFiles: string[]): string {
  const mentionRe = /@([\w./\\-]+)/g;
  let expanded = text;
  const matches = [...text.matchAll(mentionRe)];
  for (const match of matches) {
    const mention = match[1];
    // Find best-matching workspace file
    const found = workspaceFiles.find(
      (f) => f === mention || f.endsWith(`/${mention}`) || path.basename(f) === mention
    );
    if (!found) continue;
    const absPath = path.join(WORKSPACE, found);
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      const ext = path.extname(found).slice(1) || "text";
      const block = `\n\n[File: ${found}]\n\`\`\`${ext}\n${content}\n\`\`\``;
      expanded = expanded.replace(match[0], `@${found}${block}`);
    } catch {
      // Unreadable — leave mention as-is
    }
  }
  return expanded;
}

export function App() {
  const { exit }              = useApp();
  const [feedState, dispatch] = useReducer(feedReducer, initialFeedState);
  const [tokens, setTokens]   = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [navFocusIndex, setNavFocusIndex] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [isPastePreviewed, setIsPastePreviewed] = useState(false);
  const prevLenRef = useRef(0);
  const tokensRef = useRef(0);
  const workspaceFiles = useRef<string[]>([]);

  useEffect(() => {
    workspaceFiles.current = loadWorkspaceFiles();
  }, []);

  useEffect(() => { tokensRef.current = tokens; }, [tokens]);

  // Last turn entry (live or completed)
  const lastTurn = useMemo(() => {
    for (let i = feedState.entries.length - 1; i >= 0; i--) {
      const e = feedState.entries[i];
      if (e.kind === "turn") return e;
    }
    return null;
  }, [feedState.entries]);

  // Tool calls first (in stream order), then thinking blocks — matches AgentTurn order
  const expandableIds = useMemo(() => {
    if (!lastTurn || lastTurn.kind !== "turn") return [];
    const toolIds: string[] = [];
    const thinkIds: string[] = [];
    for (const ev of lastTurn.events) {
      if (ev.kind === "tool" && ev.card.status !== "running") toolIds.push(ev.card.id);
      if (ev.kind === "thinking" && ev.text) thinkIds.push(ev.id);
    }
    return [...toolIds, ...thinkIds];
  }, [lastTurn]);

  useEffect(() => {
    setNavFocusIndex(0);
  }, [lastTurn?.id]);

  const safeFocusIndex = Math.min(navFocusIndex, Math.max(0, expandableIds.length - 1));
  const focusedId      = expandableIds[safeFocusIndex] ?? null;

  // Slash command suggestions (when input starts with /)
  const slashSuggestions = useMemo((): Suggestion[] => {
    if (!inputValue.startsWith("/")) return [];
    const partial = inputValue.toLowerCase();
    return SLASH_COMMANDS
      .filter((c) => c.name.startsWith(partial))
      .map((c) => ({ label: c.name, description: c.description }));
  }, [inputValue]);

  // @mention file suggestions (triggered by @ in the last word)
  const mentionSuggestions = useMemo((): Suggestion[] => {
    const atMatch = inputValue.match(/@([\w./\\-]*)$/);
    if (!atMatch) return [];
    const partial = atMatch[1].toLowerCase();
    return workspaceFiles.current
      .filter((f) => f.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((f) => ({ label: f }));
  }, [inputValue]);

  const activeSuggestions =
    slashSuggestions.length > 0 ? slashSuggestions :
    mentionSuggestions.length > 0 ? mentionSuggestions : [];

  // Reset suggestion index when suggestion list changes
  useEffect(() => {
    setSuggestionIndex(activeSuggestions.length > 0 ? 0 : -1);
  }, [activeSuggestions.length]);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();

    // Escape: dismiss suggestions
    if (key.escape) {
      setSuggestionIndex(-1);
      return;
    }

    // Tab: suggestions take priority over navigation
    if (key.tab) {
      if (activeSuggestions.length > 0) {
        setSuggestionIndex((i) =>
          i < 0 ? 0 : (i + 1) % activeSuggestions.length
        );
        return;
      }
      if (expandableIds.length > 0) {
        setNavFocusIndex((i) => (i + 1) % expandableIds.length);
      }
      return;
    }

    // Space: expand/collapse focused expandable when input is empty
    if (_input === " " && inputValue === "" && focusedId !== null) {
      dispatch({ type: "TOGGLE_EXPANDED", id: focusedId });
      return;
    }
  });

  function handleInputChange(val: string) {
    if (val.includes("\t")) return;
    if (val === " " && inputValue === "" && focusedId !== null) return;

    // Detect large paste: input grew by more than 30 chars in one event
    const delta = val.length - prevLenRef.current;
    if (delta > 30) setIsPastePreviewed(true);
    if (val.length < prevLenRef.current) setIsPastePreviewed(false);
    prevLenRef.current = val.length;

    setInputValue(val);
    setSuggestionIndex(activeSuggestions.length > 0 ? 0 : -1);
  }

  const currentSession = sessionManager.getCurrent();

  const { submit, clearHistory, loadSession } = useAgentStream({
    dispatch,
    onTokensUpdate: setTokens,
    initialMessages: currentSession?.messages,
  });

  // On mount: if resuming a session, show a banner
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
      loadSession(msgs as Array<{ role: string; content: string }>);
      dispatch({ type: "CLEAR_FEED" });
      const sess = sessionManager.getCurrent();
      const name = sess?.name || "(unnamed)";
      dispatch({
        type: "APPEND_SYSTEM",
        id:   `resumed-${Date.now()}`,
        text: `Resumed: ${name} (${msgs.length} messages)`,
      });
    },
    [loadSession, dispatch],
  );

  const onNewSession = useCallback(() => {
    sessionManager.createSession();
    clearHistory();
    dispatch({ type: "CLEAR_FEED" });
  }, [clearHistory, dispatch]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (feedState.processing) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      // If a suggestion is selected and Enter is pressed, autocomplete instead of submit
      if (suggestionIndex >= 0 && activeSuggestions.length > 0) {
        const selected = activeSuggestions[suggestionIndex];
        if (slashSuggestions.length > 0) {
          setInputValue(selected.label + " ");
        } else {
          // @mention: replace trailing @... with the selected file
          setInputValue((v) => v.replace(/@([\w./\\-]*)$/, `@${selected.label} `));
        }
        setSuggestionIndex(-1);
        return;
      }

      setInputValue("");
      setSuggestionIndex(-1);
      setIsPastePreviewed(false);
      prevLenRef.current = 0;

      // Intercept slash commands
      const handled = handleSlashCommand(trimmed, {
        dispatch,
        clearHistory,
        getTokens: () => tokensRef.current,
        getModel: () => MODEL_NAME,
        exit,
        onResumeSession,
        onNewSession,
      });
      if (handled) return;

      // Expand @mentions to file content before sending
      const expanded = expandMentions(trimmed, workspaceFiles.current);
      await submit(expanded);
    },
    [submit, clearHistory, feedState.processing, exit, suggestionIndex, activeSuggestions, slashSuggestions, onResumeSession, onNewSession]
  );

  const agentState: AgentState = (() => {
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
  })();

  return (
    <Box flexDirection="column" height="100%">
      <Feed
        entries={feedState.entries}
        processing={feedState.processing}
        onToggle={(id) => dispatch({ type: "TOGGLE_EXPANDED", id })}
        focusedId={focusedId}
      />
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
      />
      <StatusBar tokens={tokens} agentState={agentState} sessionName={sessionManager.getCurrent()?.name} />
    </Box>
  );
}
