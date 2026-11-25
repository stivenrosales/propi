// The minute scheduler (architecture §5): for each installed workspace, ask core what is due and
// execute it as a normal command under its `rule:` / `job:` / `collab:` key. A missed tick, a
// restart or two replicas never double-pay or double-post: the key replays.
import {
  asShop,
  currentPairingRound,
  dueCelebrations,
  dueRuleEvaluations,
  issueGiftCards,
  type AppCommand,
  type CloseCollab,
  type CommandKey,
  type GiftCardProvider,
  type Instant,
  type LocalDate,
  type MemberId,
  type WorkspaceId,
} from "@propi/app";
import { lastDayOfMonth } from "@propi/core/boards";
import { COLLAB_CHECK_EVERY_MS, ledgerCheckDue, localTime, monthlyDue, nudgeHourReached, weeklyDue } from "./due.ts";
import type { Log } from "./inbound.ts";
import type { RecordNotifications, ServerNotification } from "./jobs.ts";
import type { Runtime } from "./runtime.ts";

export interface SchedulerDeps {
  readonly rt: Runtime;
  /** The workspaces to serve (the installed, not uninstalled ones). */
  workspaces(): Promise<readonly WorkspaceId[]>;
  readonly giftCards?: GiftCardProvider | null;
  readonly log: Log;
}

export interface TickReport {
  readonly workspaces: number;
  /** Job name → commands that wrote something new this tick. */
  readonly ran: Readonly<Record<string, number>>;
  readonly skipped: readonly string[];
  readonly errors: number;
}

const SYSTEM = (job: string) => ({ kind: "system", job }) as const;

export function createScheduler(d: SchedulerDeps) {
  const done = new Set<string>(); // keys this process already settled; saves re-planning every minute
  const lastLedgerCheck = new Map<WorkspaceId, LocalDate>();
  const lastCollabCheck = new Map<WorkspaceId, number>();
  const loggedOnce = new Set<string>();
  const { rt } = d;

  const once = (msg: string) => {
    if (loggedOnce.has(msg)) return;
    loggedOnce.add(msg);
    d.log(msg);
  };

  /** Executes under the command's key; true when it wrote something new. */
  async function run(cmd: AppCommand | RecordNotifications): Promise<boolean> {
    if (done.has(cmd.key)) return false;
    const r = await rt.app.executeAny(cmd);
    // Settled: written, replayed, or refused for good. A refusal such as period_not_closed may change
    // later, so only success and key reuse are remembered.
    if (r.ok || r.error.code === "idempotency_key_reused") done.add(cmd.key);
    return r.ok && !r.replayed;
  }

  const notifications = (key: string, ws: WorkspaceId, now: Instant, job: string, list: readonly ServerNotification[]): RecordNotifications => ({
    type: "RecordNotifications",
    key: key as CommandKey,
    workspaceId: ws,
    actor: SYSTEM(job),
    at: now,
    notifications: list,
  });

  async function admins(ws: WorkspaceId): Promise<MemberId[]> {
    return (await rt.ports.directory.members(ws)).filter((r) => r.active && r.role === "admin").map((r) => r.id);
  }

  async function tickWorkspace(ws: WorkspaceId, now: Instant, ran: Record<string, number>, skipped: string[]): Promise<number> {
    const settings = await rt.ports.directory.settings(ws);
    const t = localTime(now, settings.timezone);
    let errors = 0;
    const job = async (name: string, f: () => Promise<number>) => {
      try {
        const n = await f();
        if (n > 0) ran[name] = (ran[name] ?? 0) + n;
      } catch (err) {
        errors++;
        d.log("scheduler job failed", { job: name, error: err instanceof Error ? err.message : String(err) });
      }
    };
    const count = async (cmds: readonly AppCommand[]) => {
      let n = 0;
      for (const c of cmds) if (await run(c)) n++;
      return n;
    };

    await job("rules", async () => count(await dueRuleEvaluations({ ...rt.engagement, reader: rt.ports.reader, directory: rt.ports.directory }, ws, now))); // S61-S62
    await job("celebrations", async () => count(await dueCelebrations({ milestones: rt.engagement.milestones, directory: rt.ports.directory }, ws, now))); // S93-S94
    await job("pairing", async () => {
      const round = await currentPairingRound({ ...rt.engagement, reader: rt.ports.reader, directory: rt.ports.directory }, ws, now); // S95
      return round === null ? 0 : count([round]);
    });

    const week = weeklyDue(t);
    if (week !== null) {
      await job("weekly_report", async () => {
        if (done.has(`job:report:${ws}:${week}`)) return 0;
        const plan = await rt.notify.weeklyReports(ws); // S84, S85
        return (await run(notifications(plan.key, ws, now, "report", plan.notifications))) ? 1 : 0;
      });
      await job("isolation", async () => {
        if (done.has(`job:isolation:${ws}:${week}`)) return 0;
        const plan = await rt.insightsQueries.isolationAlerts(ws); // S89
        return (await run(notifications(plan.key, ws, now, "isolation", plan.notifications))) ? 1 : 0;
      });
    }
    if (nudgeHourReached(t)) {
      await job("nudge", async () => {
        const plan = await rt.notify.nudges(ws); // S86: null unless today is the nudge day
        return plan === null ? 0 : (await run(notifications(plan.key, ws, now, "nudge", plan.notifications))) ? 1 : 0;
      });
    }

    const month = monthlyDue(t);
    if (month !== null) {
      await job("reciprocity", async () => {
        const key = `job:reciprocity:${ws}:${month}`;
        if (done.has(key)) return 0;
        const flags = await rt.insightsQueries.reciprocity(ws, SYSTEM("reciprocity"), { kind: "custom", from: `${month}-01` as LocalDate, to: lastDayOfMonth(month) }); // S90
        if (!flags.ok) return 0;
        const pairs = flags.value.map((f) => ({ a: f.a, b: f.b }));
        const list = pairs.length === 0 ? [] : (await admins(ws)).map((to) => ({ type: "reciprocity_review", to, period: month, pairs }) as const);
        return (await run(notifications(key, ws, now, "reciprocity", list))) ? 1 : 0;
      });
      await job("digest", async () => {
        if (rt.summarizer === null) {
          once("monthly AI digest skipped: OPENROUTER_API_KEY is not set (S91)");
          skipped.push("digest");
          return 0;
        }
        if (done.has(`job:digest:${ws}:${month}`)) return 0;
        const digest = await rt.insightsQueries.monthlyDigest(ws, month); // S91
        const list = digest.summary === null ? [] : (await admins(ws)).map((to) => ({ type: "monthly_digest", to, month, team: digest.summary!.team }) as const);
        return (await run(notifications(digest.key, ws, now, "digest", list))) ? 1 : 0;
      });
    }

    if (now - (lastCollabCheck.get(ws) ?? 0) >= COLLAB_CHECK_EVERY_MS) {
      await job("collab_deadlines", async () => {
        lastCollabCheck.set(ws, now);
        // S58: collabs that received contributions; core refuses those whose deadline has not passed.
        const shop = asShop(rt.ports.reader.workspace(ws));
        const ids = new Set((await rt.api.outbox.events(ws)).filter((e) => e.type === "collab.contributed").map((e) => String(e.data["collabId"])));
        const cmds: CloseCollab[] = [];
        for (const id of ids) {
          const c = await shop.collab(id);
          if (c === null || c.phase !== "open" || c.deadline === null || c.deadline > now) continue;
          cmds.push({ type: "CloseCollab", key: `collab:${id}:refund` as CommandKey, workspaceId: ws, actor: SYSTEM("collab-deadline"), at: now, collabId: id, why: "deadline" });
        }
        return count(cmds);
      });
    }

    await job("gift_cards", async () => {
      if (d.giftCards === undefined || d.giftCards === null) {
        once("gift-card relay skipped: no provider configured (S108)");
        return 0;
      }
      return (await issueGiftCards(rt.app, rt.ports, d.giftCards, ws)).issued;
    });

    if (ledgerCheckDue(t, lastLedgerCheck.get(ws) ?? null)) {
      await job("ledger_check", async () => {
        const check = await rt.app.ledgerCheck(ws); // S34
        lastLedgerCheck.set(ws, t.date);
        if (!check.ok) d.log("LEDGER CHECK FAILED: stored balances differ from the replay (S34)", { workspaceId: ws, mismatches: check.mismatches.length });
        return 1;
      });
    }
    return errors;
  }

  return {
    async tick(now: Instant = rt.ports.clock.now()): Promise<TickReport> {
      const ran: Record<string, number> = {};
      const skipped: string[] = [];
      let errors = 0;
      const list = await d.workspaces();
      for (const ws of list) errors += await tickWorkspace(ws, now, ran, skipped);
      return { workspaces: list.length, ran, skipped, errors };
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
