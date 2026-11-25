// One async harness over either the in-memory ports (@propi/app/testing) or real Postgres,
// so the same scenarios run against both (the port contract test, architecture §2.2).
import {
  createApp,
  defaultSettings,
  type Actor,
  type App,
  type CommandKey,
  type CommandLogRecord,
  type DomainEvent,
  type Gift,
  type Ids,
  type InboundMessage,
  type Instant,
  type LedgerEntry,
  type MemberId,
  type MemberRecord,
  type Mention,
  type Ports,
  type Value,
  type WorkspaceId,
  type WorkspaceSettings,
} from "@propi/app";
import { createMemoryPorts } from "@propi/app/testing";
import { createDbAdmin, createDbInspector, createDbPorts, type PrismaClient } from "../src/index.ts";

/** 10:00 in America/Lima on 2026-11-25. */
export const T0 = Date.UTC(2026, 10, 25, 15, 0, 0) as Instant;
export const NEXT_DAY = Date.UTC(2026, 10, 26, 15, 0, 0) as Instant;

export const m = (s: string) => s as MemberId;
export const key = (s: string) => s as CommandKey;
export const memberActor = (id: string, role: "admin" | "approver" | "member" = "member"): Actor => ({ kind: "member", memberId: m(id), role });
export const admin = memberActor("boss", "admin");
export const mention = (id: string): Mention => ({ kind: "member", memberId: m(id) });

export const msg = (text: string, mentions: Mention[], emojis: number | string[], over: Partial<InboundMessage> = {}): InboundMessage => ({
  channel: { id: "C1", kind: "public" },
  text,
  mentions,
  emojiTokens: typeof emojis === "number" ? Array.from({ length: emojis }, () => ":taco:") : emojis,
  hashtags: [],
  ...over,
});

export interface Harness {
  readonly ws: WorkspaceId;
  readonly app: App;
  readonly ports: Ports;
  entries(): Promise<readonly LedgerEntry[]>;
  events(): Promise<readonly DomainEvent[]>;
  gifts(): Promise<readonly Gift[]>;
  commandLog(): Promise<readonly CommandLogRecord[]>;
  addMember(r: MemberRecord): Promise<void>;
  setValues(v: readonly Value[]): Promise<void>;
  updateSettings(f: (s: WorkspaceSettings) => WorkspaceSettings): Promise<void>;
  setNow(ms: number): void;
}

export type Backend = (settings?: Partial<WorkspaceSettings>) => Promise<Harness>;

let wsCounter = 0;
const PEOPLE = ["giver", "ana", "diana", "lind", "bob"];

async function seed(h: Pick<Harness, "addMember">): Promise<void> {
  for (const id of PEOPLE) await h.addMember({ id: m(id), role: "member", active: true, dailyLimitOverride: null });
  await h.addMember({ id: m("boss"), role: "admin", active: true, dailyLimitOverride: null });
  await h.addMember({ id: m("gone"), role: "member", active: false, dailyLimitOverride: null });
}

const counterIds = (): Ids => {
  let n = 0;
  return { next: (kind) => `${kind}-${++n}` };
};

export const memoryBackend: Backend = async (settings = {}) => {
  const mem = createMemoryPorts({ now: T0 });
  const ws = `ws-mem-${++wsCounter}` as WorkspaceId;
  mem.addWorkspace(ws, defaultSettings({ timezone: "America/Lima", ...settings }));
  const h: Harness = {
    ws,
    app: createApp(mem.ports),
    ports: mem.ports,
    entries: async () => mem.entries(ws),
    events: async () => mem.events(ws).map((e) => e.event),
    gifts: async () => mem.gifts(ws),
    commandLog: async () => mem.commandLog(ws),
    addMember: async (r) => mem.addMember(ws, r),
    setValues: async (v) => mem.setValues(ws, v),
    updateSettings: async (f) => mem.updateSettings(ws, f),
    setNow: (ms) => mem.clock.set(ms),
  };
  await seed(h);
  return h;
};

/** A Postgres backend on `prisma`; every harness gets its own workspace, clock and id counter. */
export function postgresBackend(prisma: () => PrismaClient): Backend {
  return async (settings = {}) => {
    const db = prisma();
    const ws = `ws-pg-${process.pid}-${++wsCounter}` as WorkspaceId;
    let now = T0 as number;
    const ports = createDbPorts(db, { clock: { now: () => now as Instant }, ids: counterIds() });
    const adminApi = createDbAdmin(db);
    const inspect = createDbInspector(db);
    await adminApi.addWorkspace(ws, defaultSettings({ timezone: "America/Lima", ...settings }));
    const h: Harness = {
      ws,
      app: createApp(ports),
      ports,
      entries: () => inspect.entries(ws),
      events: async () => (await inspect.events(ws)).map((e) => e.event),
      gifts: () => inspect.gifts(ws),
      commandLog: () => inspect.commandLog(ws),
      addMember: (r) => adminApi.addMember(ws, r),
      setValues: (v) => adminApi.setValues(ws, v),
      updateSettings: (f) => adminApi.updateSettings(ws, f),
      setNow: (ms) => void (now = ms),
    };
    await seed(h);
    return h;
  };
}
