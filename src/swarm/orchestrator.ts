import { randomUUID } from "crypto";
import { runAgentLoop } from "../agent/loop.js";
import { createDefaultMiddleware } from "../agent/middleware.js";
import { JsonFileCheckpointer } from "../agent/checkpointer.js";
import { HitlGate } from "../agent/hitl.js";
import { BtwQueue } from "../agent/btw.js";
import type { SwarmAgent, SwarmConfig, SwarmEvent } from "./types.js";
import { createSession, broadcastToSharedState, applyHandoff, createArtifactTools } from "./session.js";
import { checkCircuitBreaker } from "./circuit-breaker.js";
import { validateOutput } from "./validator.js";
import { SwarmTracer } from "./trace.js";
import { buildAgentContext, buildSystemPrompt, createHandoffTools, isHandoffResult } from "./handoff.js";

function buildAgentsByName(agents: SwarmAgent[]): Map<string, SwarmAgent> {
  return new Map(agents.map((a) => [a.name, a]));
}

export async function* runSwarm(config: SwarmConfig): AsyncGenerator<SwarmEvent> {
  const session = createSession(config);
  const tracer = new SwarmTracer(session.swarmId);
  const agentsByName = buildAgentsByName(config.agents);
  const checkpointer = config.checkpointer ?? new JsonFileCheckpointer();

  const startEvent: SwarmEvent = {
    type: "swarm-start",
    swarmId: session.swarmId,
    agents: config.agents.map((a) => a.name),
  };
  tracer.record(startEvent);
  yield startEvent;

  const initialAgent = agentsByName.get(config.initialAgent);
  if (!initialAgent) {
    throw new Error(`Initial agent "${config.initialAgent}" not found in swarm config.`);
  }

  session.activeAgent = config.initialAgent;
  session.agentHistory.push(config.initialAgent);
  session.lastHandoffDescription[config.initialAgent] = config.task;

  let totalAgentRounds = 0;

  while (session.activeAgent !== null) {
    const agentName = session.activeAgent;
    const agent = agentsByName.get(agentName);
    if (!agent) {
      throw new Error(`Active agent "${agentName}" not found.`);
    }

    const cbResult = checkCircuitBreaker(session, agent);
    if (cbResult.tripped) {
      const cbEvent: SwarmEvent = {
        type: "circuit-break",
        agent: agentName,
        reason: cbResult.reason!,
      };
      tracer.record(cbEvent);
      yield cbEvent;
      break;
    }

    const traceId = randomUUID();
    const agentStartEvent: SwarmEvent = {
      type: "agent-start",
      agent: agentName,
      traceId,
      contextMode: agent.contextMode,
    };
    tracer.record(agentStartEvent);
    yield agentStartEvent;

    const artifactTools = createArtifactTools(session);
    const handoffTools = createHandoffTools(session, agent, agentsByName);
    const allTools = [...agent.tools, ...artifactTools, ...handoffTools];

    const contextMessages = buildAgentContext(session, agent);
    const systemPrompt = buildSystemPrompt(session, agent);
    const threadId = `${session.swarmId}-${agentName}`;
    const middleware = createDefaultMiddleware(threadId);

    // Swarm agents always run full-auto — no HITL interrupts inside an orchestrated run.
    const hitlGate = new HitlGate();
    const btwQueue = new BtwQueue();

    const loopMessages = [...contextMessages];
    let agentResponse = "";
    let handoffPayload: {
      targetAgent: string;
      taskDescription: string;
      artifacts: string[];
      reasoning?: string;
    } | null = null;

    const loopGen = runAgentLoop({
      provider: config.provider,
      model: agent.model ?? config.modelName,
      tools: allTools,
      messages: loopMessages,
      systemPrompt,
      threadId,
      hitlGate,
      btwQueue,
      policy: "full_auto",
      checkpointer,
      maxRounds: agent.maxRounds,
      middleware,
    });

    for await (const event of loopGen) {
      const taggedEvent: SwarmEvent = { ...event, agent: agentName } as SwarmEvent;
      tracer.record(taggedEvent);
      yield taggedEvent;

      if (event.type === "tool-done") {
        try {
          const parsed = JSON.parse(event.result) as unknown;
          if (isHandoffResult(parsed)) {
            handoffPayload = {
              targetAgent: parsed.targetAgent,
              taskDescription: parsed.taskDescription,
              artifacts: parsed.artifacts,
              reasoning: parsed.reasoning,
            };
          }
        } catch {
          // not JSON — not a handoff
        }
      }

      if (event.type === "done") {
        agentResponse = event.response;
        totalAgentRounds += event.toolCount + 1;
        broadcastToSharedState(session, loopMessages, agentName);
      }
    }

    const agentDoneEvent: SwarmEvent = {
      type: "agent-done",
      agent: agentName,
      responseText: agentResponse,
    };
    tracer.record(agentDoneEvent);
    yield agentDoneEvent;

    const validation = validateOutput(agentResponse, agent);
    if (!validation.ok) {
      const valEvent: SwarmEvent = {
        type: "validation-fail",
        agent: agentName,
        reason: validation.reason ?? "Output validation failed.",
      };
      tracer.record(valEvent);
      yield valEvent;
    }

    if (handoffPayload) {
      const handoffEvent: SwarmEvent = {
        type: "handoff",
        from: agentName,
        to: handoffPayload.targetAgent,
        taskDescription: handoffPayload.taskDescription,
        reasoning: handoffPayload.reasoning,
      };
      tracer.record(handoffEvent);
      yield handoffEvent;

      if (!agentsByName.has(handoffPayload.targetAgent)) {
        const cbEvent: SwarmEvent = {
          type: "circuit-break",
          agent: agentName,
          reason: `Handoff target "${handoffPayload.targetAgent}" is not a registered agent.`,
        };
        tracer.record(cbEvent);
        yield cbEvent;
        break;
      }

      applyHandoff(session, handoffPayload);
      handoffPayload = null;
    } else {
      session.activeAgent = null;
    }
  }

  const doneEvent: SwarmEvent = {
    type: "swarm-done",
    swarmId: session.swarmId,
    handoffCount: session.handoffCount,
    totalAgentRounds,
  };
  tracer.record(doneEvent);
  tracer.flush();
  yield doneEvent;
}
