/**
 * OpenTelemetry span types for Chorus trace export.
 * Follows OTLP/HTTP JSON encoding for compatibility with Grafana, Honeycomb, Jaeger.
 */

export interface OTelAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { boolValue: boolean }
    | { doubleValue: number };
}

export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 1 | 2 | 3 | 4 | 5; // INTERNAL=1, SERVER=2, CLIENT=3, PRODUCER=4, CONSUMER=5
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OTelAttribute[];
  status: { code: 0 | 1 | 2 }; // UNSET=0, OK=1, ERROR=2
}

export interface OTelResource {
  attributes: OTelAttribute[];
}

export interface OTelScopeSpans {
  scope: { name: string; version?: string };
  spans: OTelSpan[];
}

export interface OTelResourceSpans {
  resource: OTelResource;
  scopeSpans: OTelScopeSpans[];
}

export interface OTelExportRequest {
  resourceSpans: OTelResourceSpans[];
}

export interface TelemetryConfig {
  /** OTLP HTTP endpoint. E.g. "http://localhost:4318/v1/traces" */
  endpoint?: string;
  /** Service name for resource attribution */
  serviceName?: string;
  /** Additional resource attributes */
  resourceAttributes?: Record<string, string>;
  /** If true, print spans to stdout instead of (or in addition to) sending to endpoint */
  stdoutExport?: boolean;
}
