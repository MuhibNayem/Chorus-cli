/**
 * Goal completion judge.
 *
 * After each headless agent turn, asks a lightweight LLM call whether the
 * stated goal has been fully achieved. Intentionally uses the cheapest/fastest
 * model to keep overhead minimal — it only needs to say "yes" or "no".
 */

import { getDefaultProvider, createProvider, getProviderModel } from "../llm/index.js";
import { getModeModelConfig } from "../settings/storage.js";

const JUDGE_PROMPT = (goal: string, lastResponse: string) =>
  `You are a strict goal-completion judge. Answer only "yes" or "no".

GOAL: ${goal}

AGENT'S LAST RESPONSE:
${lastResponse.slice(0, 3000)}

Has the goal been fully and completely achieved? Reply with exactly one word: yes or no.`;

/**
 * Returns true if the judge considers the goal met.
 * Defaults to false on any error (safe — will retry next scheduled run).
 */
export async function isGoalMet(goal: string, lastResponse: string): Promise<boolean> {
  try {
    const modeConfig = getModeModelConfig("plan"); // prefer the plan/lighter model
    const providerName = modeConfig?.provider;
    const modelName = modeConfig?.model;

    const provider = providerName ? createProvider(providerName) : await getDefaultProvider();
    const model = modelName ?? getProviderModel(provider.name);

    const messages = [{ role: "user" as const, content: JUDGE_PROMPT(goal, lastResponse) }];
    let answer = "";

    for await (const event of provider.stream({ model, messages })) {
      if (event.type === "response.delta") answer += event.text;
    }

    return answer.trim().toLowerCase().startsWith("yes");
  } catch {
    return false;
  }
}
