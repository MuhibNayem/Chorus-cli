export type { OTelSpan, OTelAttribute, TelemetryConfig } from "./types.js";
export { OTelExporter, attr, toNanos } from "./exporter.js";
export { swarmEventsToSpans } from "./bridge.js";
