import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { saveAgent } from "../../agents/storage.js";
import { generateAgentDef } from "../../agents/generator.js";
import type { AgentDef } from "../../agents/types.js";

const AVAILABLE_TOOLS = [
  "file_read", "file_write", "file_edit", "list_dir",
  "find_files", "search_files", "git_status", "git_diff",
  "git_log", "git_branch", "git_commit", "internet_search",
  "run_command",
];

const PERMISSION_MODES: AgentDef["permissionMode"][] = ["full_auto", "auto_edit", "suggest"];

interface AgentCreatorProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
  initialAgent?: AgentDef;
  aiMode?: boolean;
}

type Step = "mode" | "ai-describe" | "ai-review" | "ai-generating"
  | "name" | "description" | "systemPrompt" | "model"
  | "tools" | "permissionMode" | "maxRounds" | "confirm";

export function AgentCreator({ onDone, onCancel, initialAgent, aiMode }: AgentCreatorProps) {
  const [step, setStep] = useState<Step>(() => {
    if (initialAgent) return "name";
    if (aiMode) return "ai-describe";
    return "mode";
  });
  const [name, setName] = useState(initialAgent?.name ?? "");
  const [description, setDescription] = useState(initialAgent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initialAgent?.systemPrompt ?? "");
  const [model, setModel] = useState(initialAgent?.model ?? "");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(initialAgent?.tools ?? AVAILABLE_TOOLS));
  const [toolIndex, setToolIndex] = useState(0);
  const [permModeIndex, setPermModeIndex] = useState(() => {
    const pm = initialAgent?.permissionMode ?? "full_auto";
    return PERMISSION_MODES.indexOf(pm);
  });
  const [maxRounds, setMaxRounds] = useState(String(initialAgent?.maxRounds ?? 30));
  const [error, setError] = useState("");

  // AI mode state
  const [aiDescription, setAiDescription] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerated, setAiGenerated] = useState<{ name: string; description: string; systemPrompt: string } | null>(null);

  const isEdit = !!initialAgent;

  function clearError() { setError(""); }

  async function handleAiGenerate(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Please describe what you want the agent to do."); return; }
    setAiDescription(trimmed);
    setAiGenerating(true);
    setStep("ai-generating");
    try {
      const result = await generateAgentDef(trimmed);
      setAiGenerated(result);
      setName(result.name);
      setDescription(result.description);
      setSystemPrompt(result.systemPrompt);
      setStep("ai-review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("ai-describe");
    } finally {
      setAiGenerating(false);
    }
  }

  function goManual() {
    if (aiGenerated) {
      setName(aiGenerated.name);
      setDescription(aiGenerated.description);
      setSystemPrompt(aiGenerated.systemPrompt);
    }
    setStep("name");
  }

  function goBack() {
    clearError();
    switch (step) {
      case "mode": onCancel(); break;
      case "ai-describe": setStep("mode"); break;
      case "ai-review": setStep("ai-describe"); break;
      case "name": setStep(isEdit ? "name" : aiGenerated ? "ai-review" : "mode"); break;
      case "description": setStep("name"); break;
      case "systemPrompt": setStep("description"); break;
      case "model": setStep("systemPrompt"); break;
      case "tools": setStep("model"); break;
      case "permissionMode": setStep("tools"); break;
      case "maxRounds": setStep("permissionMode"); break;
      case "confirm": setStep("maxRounds"); break;
    }
  }

  useInput((_input, key) => {
    if (key.escape) { goBack(); return; }

    if (step === "mode") {
      if (key.upArrow) { setToolIndex((i) => (i <= 0 ? 1 : i - 1)); return; }
      if (key.downArrow) { setToolIndex((i) => (i + 1) % 2); return; }
      if (key.return) {
        if (toolIndex === 0) { setStep("ai-describe"); }
        else { setStep("name"); }
        return;
      }
      return;
    }

    if (step === "ai-review") {
      if (_input === "y") { saveAndDone(); return; }
      if (_input === "e") { goManual(); return; }
      if (_input === "r") { setStep("ai-describe"); return; }
      return;
    }

    if (step === "tools") {
      if (key.upArrow) { setToolIndex((i) => (i <= 0 ? AVAILABLE_TOOLS.length - 1 : i - 1)); return; }
      if (key.downArrow) { setToolIndex((i) => (i + 1) % AVAILABLE_TOOLS.length); return; }
      if (_input === " ") {
        const tool = AVAILABLE_TOOLS[toolIndex];
        setSelectedTools((prev) => {
          const next = new Set(prev);
          if (next.has(tool)) next.delete(tool); else next.add(tool);
          return next;
        });
        return;
      }
      if (key.return) { setStep("permissionMode"); return; }
      return;
    }

    if (step === "permissionMode") {
      if (key.upArrow) { setPermModeIndex((i) => (i <= 0 ? PERMISSION_MODES.length - 1 : i - 1)); return; }
      if (key.downArrow) { setPermModeIndex((i) => (i + 1) % PERMISSION_MODES.length); return; }
      if (key.return) { setStep("maxRounds"); return; }
      return;
    }

    if (step === "confirm") {
      if (key.return) { saveAndDone(); return; }
      return;
    }
  });

  function saveAndDone() {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!systemPrompt.trim()) { setError("System prompt is required."); return; }
    try {
      const filePath = saveAgent({
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        model: model.trim() || undefined,
        tools: selectedTools.size < AVAILABLE_TOOLS.length ? [...selectedTools] : undefined,
        permissionMode: PERMISSION_MODES[permModeIndex],
        maxRounds: Number(maxRounds) || undefined,
      }, "user");
      onDone(`Agent "${name.trim()}" saved. Use @${name.trim()} to invoke.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (step === "ai-generating") {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Box marginBottom={1}><Text color="cyan" bold>{"✦ AI Agent Generator  "}</Text><Text color="grey">Generating...</Text></Box>
        <Box borderStyle="single" borderColor="yellow" paddingX={2} paddingY={1}>
          <Text color="yellow">Generating agent definition for: "{aiDescription.slice(0, 60)}..."</Text>
        </Box>
        <Box marginTop={1}><Text color="grey" dimColor>This may take a few seconds...</Text></Box>
      </Box>
    );
  }

  if (step === "mode") {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Box marginBottom={1}><Text color="cyan" bold>{"✦ Create Agent  "}</Text><Text color="grey">Esc to cancel</Text></Box>
        <Box marginTop={1} flexDirection="column">
          <Box flexDirection="row" marginBottom={1}>
            <Text color={toolIndex === 0 ? "cyan" : "grey"} bold={toolIndex === 0}>
              {toolIndex === 0 ? "▶ " : "  "}
            </Text>
            <Box flexDirection="column">
              <Text color={toolIndex === 0 ? "cyan" : "white"} bold>AI Assisted</Text>
              <Text color="grey" dimColor>Describe what you want and the AI generates the agent definition</Text>
            </Box>
          </Box>
          <Box flexDirection="row">
            <Text color={toolIndex === 1 ? "cyan" : "grey"} bold={toolIndex === 1}>
              {toolIndex === 1 ? "▶ " : "  "}
            </Text>
            <Box flexDirection="column">
              <Text color={toolIndex === 1 ? "cyan" : "white"} bold>Manual</Text>
              <Text color="grey" dimColor>Configure every field yourself</Text>
            </Box>
          </Box>
        </Box>
        <Box marginTop={2}><Text color="grey" dimColor>↑↓ select · Enter confirm · Esc cancel</Text></Box>
      </Box>
    );
  }

  if (step === "ai-describe") {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Box marginBottom={1}><Text color="cyan" bold>{"✦ AI Agent Generator  "}</Text><Text color="grey">Step 1/2</Text></Box>
        <Text bold color="white">What should this agent do?</Text>
        <Text color="grey">Describe in plain English. The AI will generate a complete agent definition.</Text>
        <Box marginTop={1} borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
          <TextInput
            value={aiDescription}
            onChange={(v) => { clearError(); setAiDescription(v); }}
            onSubmit={handleAiGenerate}
            placeholder="e.g., A security auditor that reviews code for vulnerabilities, checks OWASP Top 10, and provides fix recommendations with severity ratings"
            focus
          />
        </Box>
        {error ? <Text color="red">{error}</Text> : null}
        <Box marginTop={1}>
          <Text color="grey" dimColor>Enter to generate · Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (step === "ai-review") {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Box marginBottom={1}><Text color="cyan" bold>{"✦ AI Agent Generator  "}</Text><Text color="green">Generated!</Text></Box>
        <Box borderStyle="single" borderColor="green" paddingX={2} paddingY={1} flexDirection="column" marginY={1}>
          <Box flexDirection="row"><Text color="grey">Name:        </Text><Text color="white" bold>{aiGenerated?.name}</Text></Box>
          <Box flexDirection="row"><Text color="grey">Description: </Text><Text>{aiGenerated?.description}</Text></Box>
          <Box marginTop={1}><Text color="grey">System Prompt (preview):</Text></Box>
          <Box borderStyle="single" borderColor="grey" paddingX={1} marginTop={0}>
            <Text dimColor>{(aiGenerated?.systemPrompt ?? "").slice(0, 300)}{(aiGenerated?.systemPrompt ?? "").length > 300 ? "..." : ""}</Text>
          </Box>
        </Box>
        <Box flexDirection="column">
          <Box flexDirection="row"><Text color="cyan" bold>  y  </Text><Text>Accept and save</Text></Box>
          <Box flexDirection="row"><Text color="cyan" bold>  e  </Text><Text>Edit manually (tweak the generated definition)</Text></Box>
          <Box flexDirection="row"><Text color="cyan" bold>  r  </Text><Text>Regenerate with different description</Text></Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{isEdit ? "✎ Edit Agent  " : "✎ Create Agent  "}</Text>
        <Text color="grey">{`Step ${getStepLabel(step)} · Esc back`}</Text>
      </Box>

      {step === "name" && (
        <Box flexDirection="column">
          <Text bold color="white">Name</Text>
          <Text color="grey">Unique identifier (kebab-case, letters/numbers/dashes).</Text>
          <Box marginTop={1} borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
            <TextInput value={name} onChange={(v) => { clearError(); setName(v); }} onSubmit={() => setStep("description")} placeholder="e.g., security-auditor" focus />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "description" && (
        <Box flexDirection="column">
          <Text bold color="white">Description</Text>
          <Text color="grey">One-line summary of what this agent does (max 80 chars).</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput value={description} onChange={setDescription} onSubmit={() => setStep("systemPrompt")} placeholder="e.g., Security auditor that reviews code for vulnerabilities" focus />
          </Box>
        </Box>
      )}

      {step === "systemPrompt" && (
        <Box flexDirection="column">
          <Text bold color="white">System Prompt</Text>
          <Text color="grey">The full system prompt. Use Markdown with Role, Responsibilities, Workflow sections.</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1} height={8}>
            <TextInput value={systemPrompt} onChange={setSystemPrompt} onSubmit={() => setStep("model")} placeholder="# Role\n\nYou are..." focus />
          </Box>
        </Box>
      )}

      {step === "model" && (
        <Box flexDirection="column">
          <Text bold color="white">Model (optional)</Text>
          <Text color="grey">Override the default model for this agent (e.g., openai:gpt-4o). Leave blank for default.</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput value={model} onChange={setModel} onSubmit={() => setStep("tools")} placeholder="e.g., openai:gpt-4o or leave empty" focus />
          </Box>
        </Box>
      )}

      {step === "tools" && (
        <Box flexDirection="column">
          <Text bold color="white">Tools</Text>
          <Text color="grey">Space to toggle · Enter to confirm</Text>
          <Box marginTop={1} flexDirection="column">
            {AVAILABLE_TOOLS.map((t, i) => (
              <Box key={t} flexDirection="row">
                <Text color={i === toolIndex ? "cyan" : "grey"} bold={i === toolIndex}>
                  {i === toolIndex ? "▶" : " "}
                </Text>
                <Text color={selectedTools.has(t) ? "green" : "grey"}>
                  {selectedTools.has(t) ? "[✓]" : "[ ]"}
                </Text>
                <Text color={i === toolIndex ? "cyan" : "white"}>
                  {` ${t}`}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {step === "permissionMode" && (
        <Box flexDirection="column">
          <Text bold color="white">Permission Mode</Text>
          <Text color="grey">How tools are approved when this agent runs.</Text>
          <Box marginTop={1} flexDirection="column">
            {PERMISSION_MODES.map((pm, i) => {
              const p = pm!;
              const desc = p === "full_auto" ? "All tools auto-approved" : p === "auto_edit" ? "Auto-approve edits, ask for shell" : "Ask before every tool call";
              return (
                <Box key={p} flexDirection="row">
                  <Text color={i === permModeIndex ? "cyan" : "grey"} bold={i === permModeIndex}>
                    {i === permModeIndex ? "▶ " : "  "}{p.padEnd(14)}
                  </Text>
                  <Text color={i === permModeIndex ? "white" : "grey"} dimColor={i !== permModeIndex}>{desc}</Text>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}><Text color="grey" dimColor>↑↓ select · Enter confirm</Text></Box>
        </Box>
      )}

      {step === "maxRounds" && (
        <Box flexDirection="column">
          <Text bold color="white">Max Rounds</Text>
          <Text color="grey">Maximum tool-use rounds per turn (default: 30).</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput value={maxRounds} onChange={setMaxRounds} onSubmit={() => setStep("confirm")} placeholder="30" focus />
          </Box>
        </Box>
      )}

      {step === "confirm" && (
        <Box flexDirection="column">
          <Text bold color="green">Review Configuration</Text>
          <Box borderStyle="single" borderColor="grey" paddingX={2} paddingY={1} flexDirection="column" marginY={1}>
            <Kv label="Name" value={name} />
            <Kv label="Description" value={description || "(none)"} />
            <Kv label="Model" value={model || "default"} />
            <Kv label="Tools" value={selectedTools.size === AVAILABLE_TOOLS.length ? "all" : [...selectedTools].join(", ")} />
            <Kv label="Perms" value={PERMISSION_MODES[permModeIndex] ?? "full_auto"} />
            <Kv label="Max Rounds" value={maxRounds} />
          </Box>
          <Text color="cyan" bold>Press Enter to save, Esc to edit</Text>
        </Box>
      )}

      {error ? <Box marginTop={1}><Text color="red">{error}</Text></Box> : null}
    </Box>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="row">
      <Text color="grey">{label.padEnd(16)}</Text>
      <Text color="white">{value}</Text>
    </Box>
  );
}

function getStepLabel(step: Step): string {
  const order: Step[] = ["name", "description", "systemPrompt", "model", "tools", "permissionMode", "maxRounds", "confirm"];
  const idx = order.indexOf(step);
  return idx >= 0 ? `${idx + 1}/${order.length}` : "";
}
