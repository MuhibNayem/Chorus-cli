/**
 * OTLP/HTTP exporter — sends OTel spans to a collector endpoint or stdout.
 */

import type { OTelExportRequest, OTelSpan, OTelAttribute, TelemetryConfig } from "./types.js";

export function attr(key: string, value: string | number | boolean): OTelAttribute {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  return { key, value: { doubleValue: value as number } };
}

export function toNanos(ms: number): string {
  return String(ms * 1_000_000);
}

export class OTelExporter {
  private config: TelemetryConfig;

  constructor(config: TelemetryConfig = {}) {
    this.config = config;
  }

  async exportSpans(spans: OTelSpan[]): Promise<void> {
    if (spans.length === 0) return;

    const payload: OTelExportRequest = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              attr("service.name", this.config.serviceName ?? "chorus-cli"),
              attr("service.version", "1.0.0"),
              ...Object.entries(this.config.resourceAttributes ?? {}).map(([k, v]) => attr(k, v)),
            ],
          },
          scopeSpans: [
            {
              scope: { name: "chorus.swarm", version: "1.0.0" },
              spans,
            },
          ],
        },
      ],
    };

    if (this.config.stdoutExport) {
      process.stdout.write(`[otel] ${JSON.stringify(payload)}\n`);
    }

    if (this.config.endpoint) {
      try {
        await fetch(this.config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        // Non-fatal: telemetry export failure should never break the agent run
        process.stderr.write(`[chorus] OTel export failed: ${String(err)}\n`);
      }
    }
  }
}
