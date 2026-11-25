// Config, G7 ack ordering, the digest reply parser and the import arguments.
import { describe, expect, test } from "vitest";
import type { App as BoltApp, ReceiverEvent } from "@slack/bolt";
import { deferEventAcks } from "../src/bolt.ts";
import { ConfigError, describeConfig, loadConfig } from "../src/config.ts";
import { parseImportArgs, ImportUsageError } from "../src/import.ts";
import { parseDigestReply } from "../src/summarizer.ts";

const BASE = { DATABASE_URL: "postgresql://x", SLACK_BOT_TOKEN: "xoxb-synthetic", SLACK_APP_TOKEN: "xapp-synthetic" };

describe("config", () => {
  test("Socket Mode is the default and needs SLACK_APP_TOKEN", () => {
    expect(loadConfig(BASE).slack?.mode).toBe("socket");
    expect(() => loadConfig({ ...BASE, SLACK_APP_TOKEN: "" })).toThrow(new ConfigError("SLACK_APP_TOKEN is required (Socket Mode app-level token xapp-…)"));
  });
  test("HTTP mode when SLACK_SOCKET_MODE=false, which needs SLACK_SIGNING_SECRET", () => {
    expect(() => loadConfig({ ...BASE, SLACK_SOCKET_MODE: "false" })).toThrow(/SLACK_SIGNING_SECRET is required/);
    expect(loadConfig({ ...BASE, SLACK_SOCKET_MODE: "false", SLACK_SIGNING_SECRET: "s" }).slack?.mode).toBe("http");
    expect(() => loadConfig({ ...BASE, SLACK_SOCKET_MODE: "maybe" })).toThrow(/true or false/);
  });
  test("S91: the digest is on only with OPENROUTER_API_KEY; describeConfig never prints secrets", () => {
    const off = loadConfig(BASE);
    expect(off.openRouter).toBeNull();
    const on = loadConfig({ ...BASE, OPENROUTER_API_KEY: "sk-synthetic", PORT: "4000", APP_URL: "https://propi.example/" });
    expect(on).toMatchObject({ port: 4000, appUrl: "https://propi.example", openRouter: { apiKey: "sk-synthetic" } });
    const printed = JSON.stringify(describeConfig(on));
    for (const secret of ["sk-synthetic", "xoxb-synthetic", "xapp-synthetic", "postgresql://x"]) expect(printed).not.toContain(secret);
  });
});

describe("G7: events are acknowledged only after the listener finished", () => {
  const fakeApp = (listener: () => Promise<void>) => {
    const order: string[] = [];
    const app = {
      async processEvent(event: ReceiverEvent) {
        await event.ack(); // Bolt acks Events API requests before listeners
        order.push("listener-start");
        await listener();
        order.push("listener-done");
      },
    } as unknown as BoltApp;
    deferEventAcks(app);
    const event = (type: string): ReceiverEvent => ({ body: { type }, ack: async () => void order.push("ack") }) as unknown as ReceiverEvent;
    return { app, order, event };
  };

  test("an event is acked after execute committed", async () => {
    const f = fakeApp(async () => undefined);
    await f.app.processEvent(f.event("event_callback"));
    expect(f.order).toEqual(["listener-start", "listener-done", "ack"]);
  });
  test("a failing event is never acked, so Slack retries (S17 replays)", async () => {
    const f = fakeApp(async () => {
      throw new Error("db down");
    });
    await expect(f.app.processEvent(f.event("event_callback"))).rejects.toThrow("db down");
    expect(f.order).toEqual(["listener-start"]);
  });
  test("interactivity keeps Bolt's own ack (listeners call ack themselves)", async () => {
    const f = fakeApp(async () => undefined);
    await f.app.processEvent(f.event("block_actions"));
    expect(f.order).toEqual(["ack", "listener-start", "listener-done"]);
  });
});

describe("S91 digest reply", () => {
  test("parses JSON wrapped in prose and drops malformed themes", () => {
    const reply = 'Here you go:\n{"team":[{"title":"Ownership","summary":"x","valueId":null,"giftIds":["g1",3]},{"title":1}],"members":[{"memberId":"ana","themes":[]},{"x":1}]}';
    expect(parseDigestReply(reply)).toEqual({ team: [{ title: "Ownership", summary: "x", valueId: null, giftIds: ["g1"] }], members: [{ memberId: "ana", themes: [] }] });
    expect(parseDigestReply("not json")).toEqual({ team: [], members: [] });
  });
});

describe("import arguments", () => {
  test("G6: --until reuses the CLI parser; --team is required", () => {
    expect(parseImportArgs(["./export", "--team", "T0PROPI001", "--until", "2026-11-25T00:00:00Z"])).toEqual({ dir: "./export", team: "T0PROPI001", until: Date.parse("2026-11-25T00:00:00Z") });
    expect(() => parseImportArgs(["./export"])).toThrow(new ImportUsageError("import needs --team <slack team id>"));
    expect(() => parseImportArgs(["./export", "--team", "T", "--until", "yesterday"])).toThrow(/invalid --until/);
  });
});
