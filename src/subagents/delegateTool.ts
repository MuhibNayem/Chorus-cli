import { tool } from "../tools/tool.js";
import { z } from "zod";
import type { LLMProvider } from "../llm/provider.js";
import type { Dispatch } from "react";
import type { FeedAction } from "../cli/state/feedReducer.js";
import { executeSubagent } from "./runtime.js";
import { getAllSubagents } from "./index.js";

export function createDelegateTool(options: {
  provider: LLMProvider;
  modelName: string;
  dispatch: Dispatch<FeedAction>;
  parentTurnId: string;
}) {
  const { provider, modelName, dispatch, parentTurnId } = options;

  // Resolve at tool-creation time so the description seen by the LLM is accurate.
  const agents = getAllSubagents();
  const agentNames = agents.map((a) => a.name);
  const agentList = agents
    .map((a) => `${a.name} (${a.description})`)
    .join(", ");

  return tool(
    async ({ subagent, task }: { subagent: string; task: string }) => {
      // Runtime validation — getAllSubagents() may have changed since tool creation
      // (e.g., hot-reload), so re-check each call.
      const current = getAllSubagents();
      if (!current.some((a) => a.name === subagent)) {
        const available = current.map((a) => a.name).join(", ");
        return `Error: Unknown subagent "${subagent}". Available subagents: ${available}.`;
      }

      try {
        return await executeSubagent({
          subagentName: subagent,
          task,
          provider,
          modelName,
          dispatch,
          parentTurnId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error delegating to subagent "${subagent}": ${message}`;
      }
    },
    {
      name: "delegate_to_subagent",
      description:
        `Delegate a specialized task to a subagent. Use this when the task requires deep ` +
        `expertise. The subagent will execute independently and return its findings. ` +
        `Available subagents: ${agentList}.`,
      schema: z.object({
        subagent: z
          .string()
          .describe(`The subagent to delegate to. Available: ${agentNames.join(", ")}.`),
        task: z
          .string()
          .describe(
            "The detailed task to delegate to the subagent. Be specific about what you need.",
          ),
      }),
    },
  );
}
