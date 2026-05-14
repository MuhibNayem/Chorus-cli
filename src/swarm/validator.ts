import type { SwarmAgent } from "./types.js";

export function validateOutput(
  output: string,
  agent: SwarmAgent,
): { ok: boolean; reason?: string } {
  if (!agent.outputValidator) return { ok: true };
  try {
    return agent.outputValidator(output);
  } catch (err) {
    return {
      ok: false,
      reason: `Validator threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
