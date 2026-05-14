/**
 * Channel SSE Server — HTTP server that streams ChannelEvents to subscribers.
 *
 * GET /events           → SSE stream of all events
 * GET /events/:session  → SSE stream filtered to one session
 * GET /health           → liveness check
 */

import * as http from "http";
import type { ChannelEvent } from "./types.js";
import type { EventBroadcaster } from "./broadcaster.js";

export interface ChannelServerConfig {
  port?: number;
  host?: string;
  broadcaster: EventBroadcaster;
  /** CORS origins to allow. Default: "*" */
  corsOrigin?: string;
}

export class ChannelServer {
  private server: http.Server;
  private config: ChannelServerConfig;
  private port: number;
  private host: string;

  constructor(config: ChannelServerConfig) {
    this.config = config;
    this.port = config.port ?? 3211;
    this.host = config.host ?? "127.0.0.1";
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const corsOrigin = this.config.corsOrigin ?? "*";
    const cors = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ status: "ok", ts: Date.now() }));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/events")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const filterSessionId = parts[1] ?? null;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...cors,
      });

      // Send immediate heartbeat so the client knows the connection is live
      res.write(`data: ${JSON.stringify({ type: "heartbeat", ts: Date.now() })}\n\n`);

      const unsub = this.config.broadcaster.subscribe((event: ChannelEvent) => {
        if (filterSessionId) {
          const sessionId = "sessionId" in event ? event.sessionId : null;
          if (sessionId && sessionId !== filterSessionId) return;
        }
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // client disconnected
        }
      });

      req.on("close", unsub);
      req.on("error", unsub);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "Not found" }));
  }
}
