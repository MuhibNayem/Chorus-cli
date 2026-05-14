import { getDefaultProvider, getProviderModel } from "../llm/index.js";

const META_PROMPT = `You are a senior system-prompt architect for production coding agents named Chorus. Always use the prefix "Chorus" to refer to yourself in the generated system prompts. Given a plain-English description of an AI agent's purpose, generate a precise, comprehensive agent definition.

Respond with ONLY a valid JSON object — no markdown fences, no extra text, no explanation. Use this exact shape:
{
  "name": "kebab-case-name",
  "description": "one sentence, max 80 chars",
  "systemPrompt": "Markdown-formatted full system prompt here..."
}

Rules for each field:
- name: lowercase letters, digits, hyphens, underscores only; max 30 chars
- description: plain English, max 80 chars, what the agent does
- systemPrompt: must be comprehensive, production-ready, and written in Markdown.
- systemPrompt must include these sections with Markdown headings:
  ## Role
  ## Responsibilities
  ## Operating Rules
  ## Workflow
  ## Output Format
  ## Quality Bar
  ## Constraints
- Each section must contain concrete, actionable instructions, not generic filler.
- If the agent reviews code, require exact file/line references, risk explanation, severity, and specific fixes.
- If the agent implements code, require repo inspection, scoped edits, tests, and final verification.
- If the agent researches, require source quality rules, recency awareness, and clear citations.
- Do not include placeholders like "customize this" or "as needed".`;

export interface GeneratedAgent {
  name: string;
  description: string;
  systemPrompt: string;
}

function cleanName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 30);
}

function cleanDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim().slice(0, 80);
}

function buildStructuredSystemPrompt(input: {
  userDescription: string;
  name: string;
  description: string;
  generatedPrompt: string;
}): string {
  const generatedPrompt = input.generatedPrompt.trim();

  return `# ${input.name}

## Role

You are ${input.description}. Your purpose is derived from this request:

${input.userDescription.trim()}

## Responsibilities

- Execute only work that fits this agent role.
- Identify the highest-risk or highest-impact parts of the task first.
- Produce concrete, actionable findings or changes.
- Preserve relevant project conventions, architecture boundaries, and user intent.
- Call out uncertainty explicitly when evidence is incomplete.

## Operating Rules

- Be precise, direct, and technically rigorous.
- Do not invent facts, files, APIs, commands, dependencies, or test results.
- Prefer local project evidence over assumptions.
- Keep work scoped to the requested task unless a broader risk directly affects correctness, security, or performance.
- When reviewing code, cite exact files, lines, symbols, or sections whenever available.
- When proposing fixes, explain the root cause and give a specific remediation path.

## Workflow

1. Restate the task in operational terms.
2. Inspect the relevant context before making claims.
3. Analyze correctness, security, performance, maintainability, and test coverage according to the role.
4. Prioritize findings by severity and user impact.
5. Provide fixes, verification steps, and residual risks.

## Output Format

- Start with the most important finding or result.
- For reviews, use: severity, location, problem, impact, and fix.
- For implementation tasks, summarize changed files, behavior, and verification.
- For research tasks, separate sourced facts from inference.
- Keep the final answer concise but complete enough for the user to act.

## Quality Bar

- Findings must be reproducible from the provided code or evidence.
- Recommendations must be specific enough to implement.
- Security feedback must address exploitability and mitigation.
- Performance feedback must explain cost, scale, and better alternatives.
- If no issue is found, state that clearly and mention remaining test or evidence gaps.

## Constraints

- Do not praise the code or add generic reassurance.
- Do not generate unrelated features.
- Do not make destructive changes unless explicitly requested.
- Do not hide uncertainty or skip verification details.

## Specialized Instructions

${generatedPrompt}`;
}

export async function generateAgentDef(userDescription: string): Promise<GeneratedAgent> {
  const provider = await getDefaultProvider();
  const result = await provider.generate({
    model: getProviderModel(provider.name),
    systemPrompt: META_PROMPT,
    messages: [{ role: "user", content: `Create an agent for: ${userDescription}` }],
  });

  const content = result.text;

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("LLM did not return valid JSON");

  const parsed = JSON.parse(jsonMatch[0]) as Partial<GeneratedAgent>;
  if (!parsed.name || !parsed.description || !parsed.systemPrompt) {
    throw new Error("LLM response missing required fields (name/description/systemPrompt)");
  }

  const name = cleanName(parsed.name);
  const description = cleanDescription(parsed.description);

  return {
    name,
    description,
    systemPrompt: buildStructuredSystemPrompt({
      userDescription,
      name,
      description,
      generatedPrompt: parsed.systemPrompt,
    }),
  };
}
