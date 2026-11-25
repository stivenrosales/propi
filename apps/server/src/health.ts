// GET /healthz for the container healthcheck: 200 when Postgres answers and Slack is either connected
// or not configured yet. Without SLACK_BOT_TOKEN the server runs health only (startHealthServer), so
// a fresh deploy waiting for the Slack app's tokens stays up instead of restart-looping.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type SlackHealth = "starting" | "ready" | "not_configured";

export interface HealthState {
  slack: SlackHealth;
  lastLoopError: string | null;
}

export function healthRoute(state: HealthState, pingDb: () => Promise<void>, timeoutMs = 2000) {
  return {
    path: "/healthz",
    method: ["GET"],
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      let db = "ok";
      try {
        await Promise.race([pingDb(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs).unref())]);
      } catch (err) {
        db = err instanceof Error ? err.message : "error";
      }
      const ok = db === "ok" && state.slack !== "starting";
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok, db, slack: state.slack, lastLoopError: state.lastLoopError }));
    },
  };
}

/** A plain HTTP server for the health-only mode: /healthz, 404 for everything else. */
export async function startHealthServer(port: number, route: ReturnType<typeof healthRoute>): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === route.path && route.method.includes(req.method ?? "")) {
      route.handler(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
