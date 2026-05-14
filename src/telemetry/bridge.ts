/**
 * SwarmEvent → OTel span bridge.
 *
 * Converts a full swarm trace (JSONL events) into a tree of OTel spans:
 *   swarm-start..swarm-done  → root span
 *   wave-start..wave-done    → child spans of root
 *   agent-start..agent-done  → child spans of their wave
 */

import { randomBytes } from "crypto";
import type { SwarmEvent } from "../swarm/types.js";
import type { OTelSpan } from "./types.js";
import { attr, toNanos } from "./exporter.js";

function hexId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

interface SpanContext {
  traceId: string;
  spanId: string;
  startMs: number;
}

export function swarmEventsToSpans(events: Array<SwarmEvent & { ts: number }>): OTelSpan[] {
  const spans: OTelSpan[] = [];

  const traceId = hexId(16);
  let swarmSpan: SpanContext | null = null;
  const waveSpans = new Map<number, SpanContext>();
  const agentSpans = new Map<string, SpanContext & { waveSpanId?: string }>();
  let swarmId = "";

  for (const event of events) {
    switch (event.type) {
      case "swarm-start": {
        swarmId = event.swarmId;
        swarmSpan = { traceId, spanId: hexId(8), startMs: event.ts };
        break;
      }

      case "swarm-done": {
        if (!swarmSpan) break;
        spans.push({
          traceId,
          spanId: swarmSpan.spanId,
          name: `swarm ${swarmId}`,
          kind: 1,
          startTimeUnixNano: toNanos(swarmSpan.startMs),
          endTimeUnixNano: toNanos(event.ts),
          attributes: [
            attr("chorus.swarm_id", swarmId),
            attr("chorus.total_agents", event.totalAgentRounds),
            attr("chorus.input_tokens", event.totalInputTokens),
            attr("chorus.output_tokens", event.totalOutputTokens),
            attr("chorus.cost_usd", event.totalCostUsd),
          ],
          status: { code: 1 },
        });
        break;
      }

      case "wave-start": {
        const waveSpanId = hexId(8);
        waveSpans.set(event.wave, { traceId, spanId: waveSpanId, startMs: event.ts });
        break;
      }

      case "wave-done": {
        const ws = waveSpans.get(event.wave);
        if (!ws || !swarmSpan) break;
        spans.push({
          traceId,
          spanId: ws.spanId,
          parentSpanId: swarmSpan.spanId,
          name: `wave ${event.wave}`,
          kind: 1,
          startTimeUnixNano: toNanos(ws.startMs),
          endTimeUnixNano: toNanos(event.ts),
          attributes: [
            attr("chorus.wave", event.wave),
            attr("chorus.agents", event.agents.join(",")),
          ],
          status: { code: 1 },
        });
        break;
      }

      case "agent-start": {
        // Find which wave this agent belongs to by checking recent wave-start events
        const currentWave = Math.max(-1, ...waveSpans.keys());
        const waveCtx = currentWave >= 0 ? waveSpans.get(currentWave) : undefined;
        agentSpans.set(event.agent, {
          traceId,
          spanId: hexId(8),
          startMs: event.ts,
          waveSpanId: waveCtx?.spanId,
        });
        break;
      }

      case "agent-done": {
        const as = agentSpans.get(event.agent);
        if (!as) break;
        spans.push({
          traceId,
          spanId: as.spanId,
          parentSpanId: as.waveSpanId ?? swarmSpan?.spanId,
          name: `agent ${event.agent}`,
          kind: 1,
          startTimeUnixNano: toNanos(as.startMs),
          endTimeUnixNano: toNanos(event.ts),
          attributes: [
            attr("chorus.agent", event.agent),
            attr("chorus.input_tokens", event.metrics.inputTokens),
            attr("chorus.output_tokens", event.metrics.outputTokens),
            attr("chorus.cost_usd", event.metrics.costUsd),
            attr("chorus.rounds", event.metrics.rounds),
            attr("chorus.tool_calls", event.metrics.toolCalls),
          ],
          status: { code: 1 },
        });
        break;
      }

      case "circuit-break": {
        const as = agentSpans.get(event.agent);
        if (as) {
          spans.push({
            traceId,
            spanId: as.spanId,
            parentSpanId: as.waveSpanId ?? swarmSpan?.spanId,
            name: `agent ${event.agent} [circuit-broken]`,
            kind: 1,
            startTimeUnixNano: toNanos(as.startMs),
            endTimeUnixNano: toNanos(event.ts),
            attributes: [
              attr("chorus.agent", event.agent),
              attr("chorus.failure_reason", event.reason),
            ],
            status: { code: 2 },
          });
        }
        break;
      }
    }
  }

  return spans;
}
