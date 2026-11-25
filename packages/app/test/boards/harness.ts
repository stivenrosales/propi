// Use-case harness for the boards/notify/insights/privacy/values unit: real commands through
// createApp with the in-memory fakes, plus the insights read port.
import type { Instant, ValueId } from "@propi/core";
import type { Summarizer } from "@propi/core/insights";
import { createApp } from "../../src/index.ts";
import { boardQueries } from "../../src/boards/index.ts";
import { insightsQueries } from "../../src/insights/index.ts";
import { notifyQueries } from "../../src/notify/index.ts";
import { privacyQueries } from "../../src/privacy/index.ts";
import { createMemoryInsights } from "../../src/testing/insights.ts";
import { WS, giveCmd, mention, msg, setup } from "../setup.ts";

/** 10:00 in Lima on a local date. */
export const lima = (date: string, hour = 10): Instant => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d, hour + 5) as Instant;
};

export interface GiveOpts {
  readonly on?: string;
  readonly ref?: string;
  readonly hashtags?: readonly string[];
  readonly emojis?: readonly string[];
  readonly channel?: { readonly id: string; readonly kind: "public" | "private" };
  readonly text?: string;
}

export function harness(opts: Parameters<typeof setup>[0] & { summarizer?: Summarizer } = {}) {
  const { mem } = setup(opts);
  mem.setValues(WS, [
    { id: "v-own" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: ":muscle:" },
    { id: "v-fun" as ValueId, name: "Fun", hashtag: "#fun", emoji: ":tada:" },
  ]);
  const insights = createMemoryInsights(mem);
  const app = createApp(mem.ports);
  const deps = opts.summarizer === undefined ? { ports: mem.ports, source: insights.source } : { ports: mem.ports, source: insights.source, summarizer: opts.summarizer };
  let n = 0;
  return {
    mem,
    app,
    insights,
    boards: boardQueries(deps),
    notify: notifyQueries(deps),
    insightsQ: insightsQueries(deps),
    privacy: privacyQueries(deps),
    async give(from: string, to: readonly string[], units: number, o: GiveOpts = {}) {
      mem.clock.set(lima(o.on ?? "2026-11-25"));
      const text = o.text ?? `${to.map((t) => `@${t}`).join(" ")} thanks ${":taco:".repeat(units)}`;
      const message = msg(text, to.map(mention), o.emojis ? [...o.emojis] : units, { hashtags: [...(o.hashtags ?? [])], channel: o.channel ?? { id: "C1", kind: "public" } });
      const r = await app.execute(giveCmd(from, message, o.ref ?? `T:C1:h${++n}`));
      mem.clock.set(lima("2026-11-25"));
      if (!r.ok) throw new Error(`gift failed: ${JSON.stringify(r)}`);
      return r.value;
    },
  };
}
