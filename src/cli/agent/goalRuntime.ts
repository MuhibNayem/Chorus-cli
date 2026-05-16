import type { ChatMessage } from "../../llm/provider.js";
import { getDefaultProvider, getProviderModel } from "../../llm/index.js";

export interface GoalEvaluation {
  met: boolean;
  reason: string;
  guidance: string;
}

const GOAL_EVALUATOR_PROMPT = `You are a goal evaluator. Your job is to determine whether a condition has been met based on the conversation transcript.

You will receive:
1. The goal condition
2. The full conversation transcript (including tool calls, test results, file edits)

Evaluate whether the condition is definitively met. Be strict — only say "yes" if there is clear, verifiable evidence in the transcript.

Respond with ONLY a JSON object:
{
  "met": true or false,
  "reason": "brief explanation of why the goal IS or IS NOT met",
  "guidance": "if not met, specific next step for the agent to take. if met, empty string."
}`;

/**
 * Evaluate whether a goal condition has been met based on the conversation transcript.
 * Uses the default provider (or a fast model if configured) to save costs.
 */
export async function evaluateGoal(
  condition: string,
  messages: ChatMessage[],
): Promise<GoalEvaluation> {
  const provider = await getDefaultProvider();
  const model = getProviderModel(provider.name);

  // Build transcript from messages
  const transcript = messages
    .map((m) => {
      const role = m.role.toUpperCase();
      const content = m.content.slice(0, 500); // truncate for evaluator efficiency
      const reasoning = m.reasoning_content ? ` [reasoning: ${m.reasoning_content.slice(0, 200)}]` : "";
      return `[${role}]${reasoning} ${content}`;
    })
    .join("\n");

  const result = await provider.generate({
    model,
    systemPrompt: GOAL_EVALUATOR_PROMPT,
    messages: [
      {
        role: "user",
        content: `Goal condition: ${condition}\n\nConversation transcript:\n${transcript}\n\nIs the goal met?`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(result.text) as GoalEvaluation;
    return {
      met: !!parsed.met,
      reason: parsed.reason || (parsed.met ? "Goal met." : "Goal not yet met."),
      guidance: parsed.guidance || "",
    };
  } catch {
    // If JSON parse fails, treat as not met for safety
    return {
      met: false,
      reason: "Evaluator response could not be parsed.",
      guidance: "Continue working toward the goal.",
    };
  }
}

export function formatGoalStatus(
  condition: string,
  turns: number,
  startedAt: number,
  totalTokens: number,
): string {
  const elapsed = Date.now() - startedAt;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  const elapsedStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const tokenStr = totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : `${totalTokens}`;

  return `◎ /goal active — ${turns} turns, ${elapsedStr}, ${tokenStr} tokens · /goal clear to stop`;
}
