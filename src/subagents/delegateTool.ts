import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Dispatch } from "react";
import type { FeedAction } from "../cli/state/feedReducer.js";
import { executeSubagent } from "./runtime.js";

const SUBAGENT_NAMES = ["planner", "vapt", "builder"] as const;

export function createDelegateTool(options: {
  model: BaseChatModel;
  dispatch: Dispatch<FeedAction>;
  parentTurnId: string;
}) {
  const { model, dispatch, parentTurnId } = options;

  return tool(
    async ({ subagent, task }: { subagent: string; task: string }) => {
      if (!SUBAGENT_NAMES.includes(subagent as (typeof SUBAGENT_NAMES)[number])) {
        return `Error: Unknown subagent "${subagent}". Available subagents: ${SUBAGENT_NAMES.join(", ")}.`;
      }

      try {
        const result = await executeSubagent({
          subagentName: subagent,
          task,
          model,
          dispatch,
          parentTurnId,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error delegating to subagent "${subagent}": ${message}`;
      }
    },
    {
      name: "delegate_to_subagent",
      description:
        "Delegate a specialized task to a subagent. Use this when the task requires deep expertise in architecture, security, or production engineering. " +
        "The subagent will execute independently and return its findings. " +
        "Available subagents: planner (system architecture), vapt (security/penetration testing), builder (production code engineering).",
      schema: z.object({
        subagent: z
          .enum(SUBAGENT_NAMES)
          .describe("The subagent to delegate to: planner, vapt, or builder"),
        task: z
          .string()
          .describe("The detailed task to delegate to the subagent. Be specific about what you need."),
      }),
    }
  );
}
