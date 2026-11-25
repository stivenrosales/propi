// `propi-server import <dir> --team <T…> [--until <timestamp>]`: imports a HeyTaco export into the
// Postgres workspace installed for that Slack team (S101-S105). Reuses the importer package and the
// CLI's --until parsing (G6). Members are matched to linked Slack identities first (S102), and new
// ones get their Slack identity linked, so live Slack events reach the same balances (S107).
// Output is aggregate counts only: no names, emails or Slack ids.
import { createApp, type Instant, type WorkspaceId } from "@propi/app";
import { parseUntil } from "@propi/cli/src/cli.ts";
import { HEYTACO_HANDLERS, importHeyTaco, planHeyTacoImport, readHeyTacoExport, type KnownIdentity } from "@propi/heytaco";
import type { Runtime } from "./runtime.ts";

export const IMPORT_USAGE = `usage: propi-server import <dir> --team <slack team id> [--until <timestamp>]
  --until keeps rows strictly before the timestamp (G6): ISO 8601 with a zone, or "YYYY-MM-DD HH:MM:SS" in the export timezone.
  The Slack team must already be installed (start the server once).`;

export class ImportUsageError extends Error {}

export function parseImportArgs(argv: readonly string[]): { readonly dir: string; readonly team: string; readonly until: Instant | null } {
  let dir: string | null = null;
  let team: string | null = null;
  let until: Instant | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--team" || a === "--until") {
      const v = argv[++i];
      if (v === undefined) throw new ImportUsageError(`${a} needs a value`);
      if (a === "--team") team = v;
      else {
        try {
          until = parseUntil(v);
        } catch (e) {
          throw new ImportUsageError(e instanceof Error ? e.message : String(e));
        }
      }
    } else if (a.startsWith("-")) throw new ImportUsageError(`unknown option ${a}`);
    else if (dir === null) dir = a;
    else throw new ImportUsageError(`unexpected argument ${a}`);
  }
  if (dir === null) throw new ImportUsageError("import needs an export directory");
  if (team === null) throw new ImportUsageError("import needs --team <slack team id>");
  return { dir, team, until };
}

export async function importIntoWorkspace(rt: Runtime, args: { readonly dir: string; readonly team: string; readonly until: Instant | null }) {
  const inst = await rt.installations.find("slack", args.team);
  if (inst === null) throw new Error("that Slack team is not installed; start the server once first");
  const ws: WorkspaceId = inst.workspaceId;
  const settings = await rt.ports.directory.settings(ws);
  const known: KnownIdentity[] = (await rt.identityStore.list(ws))
    .filter((i) => i.platform === "slack" && i.tenantId === args.team)
    .map((i) => ({ memberId: i.memberId, slackUserId: i.userId, email: null }));
  const data = readHeyTacoExport(args.dir);
  const plan = planHeyTacoImport(data, { workspaceId: ws, settings, until: args.until, known });
  const app = createApp(rt.ports, { handlers: HEYTACO_HANDLERS });
  let identitiesLinked = 0;
  let membersCreated = 0;
  const registrar = {
    async register(w: WorkspaceId, m: Parameters<typeof rt.admin.addMember>[1] & { readonly slackUserId: string | null }) {
      // Importer ids are deterministic; a member from an earlier import keeps its current role and state.
      if ((await rt.ports.directory.member(w, m.id)) === null) {
        await rt.admin.addMember(w, { id: m.id, role: m.role, active: m.active, dailyLimitOverride: m.dailyLimitOverride });
        membersCreated++;
      }
      if (m.slackUserId !== null) {
        const r = await rt.identities.link({ actor: { kind: "system", job: "import" }, workspaceId: w, identity: { platform: "slack", tenantId: args.team, userId: m.slackUserId }, memberId: m.id });
        if (r.ok && r.value.changed) identitiesLinked++;
      }
    },
  };
  const run = await importHeyTaco({ app, registrar, workspaceId: ws, plan });
  const ledgerCheck = await rt.app.ledgerCheck(ws);
  const s = plan.stats;
  const report = {
    storage: "postgres",
    until: args.until === null ? null : new Date(args.until).toISOString(),
    ...run,
    membersCreated,
    identitiesLinked,
    activityRowsRead: s.activityInWindow,
    activityRowsSkippedByCutoff: s.activityRows - s.activityInWindow,
    redemptionRowsRead: s.redemptionInWindow,
    redemptionRowsSkippedByCutoff: s.redemptionRows - s.redemptionInWindow,
    ledgerCheck: ledgerCheck.ok,
    membersChecked: ledgerCheck.members,
  };
  return { ok: Object.keys(run.rejected).length === 0 && ledgerCheck.ok, report };
}
