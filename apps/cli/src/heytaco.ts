// `import` and `reconcile` for HeyTaco exports. Runs through createApp with the in-memory ports for now;
// a later step swaps in the Postgres ports (packages/db). Output is aggregate counts only.
import { createApp, defaultSettings, type Balances, type Instant, type MemberId, type WorkspaceId } from "@propi/app";
import { createMemoryPorts } from "@propi/app/testing";
import {
  HEYTACO_HANDLERS,
  HEYTACO_EXPORT_TIMEZONE,
  importHeyTaco,
  planHeyTacoImport,
  readHeyTacoExport,
  reconcileImport,
  type HeyTacoExport,
  type ImportPlan,
  type KnownIdentity,
} from "@propi/heytaco";

const WORKSPACE = "heytaco-import" as WorkspaceId;

function memoryWorld() {
  const mem = createMemoryPorts();
  const settings = defaultSettings({ timezone: HEYTACO_EXPORT_TIMEZONE });
  mem.addWorkspace(WORKSPACE, settings);
  const app = createApp(mem.ports, { handlers: HEYTACO_HANDLERS });
  const registrar = { register: async (ws: WorkspaceId, m: Parameters<typeof mem.addMember>[1]) => mem.addMember(ws, m) };
  return { mem, app, settings, registrar };
}

const plan = (data: HeyTacoExport, settings: ReturnType<typeof defaultSettings>, until: Instant | null, known: readonly KnownIdentity[]) =>
  planHeyTacoImport(data, { workspaceId: WORKSPACE, settings, until, known });

const identities = (p: ImportPlan): KnownIdentity[] => p.members.map((m) => ({ memberId: m.id, slackUserId: m.slackUserId, email: m.email }));

export async function importCommand(dir: string, until: Instant | null) {
  const data = readHeyTacoExport(dir);
  const w = memoryWorld();
  const p = plan(data, w.settings, until, []);
  const run = await importHeyTaco({ app: w.app, registrar: w.registrar, workspaceId: WORKSPACE, plan: p });
  const report = {
    storage: "memory",
    until: until === null ? null : new Date(until).toISOString(),
    ...run,
    activityRowsRead: p.stats.activityInWindow,
    activityRowsSkippedByCutoff: p.stats.activityRows - p.stats.activityInWindow,
    redemptionRowsRead: p.stats.redemptionInWindow,
    redemptionRowsSkippedByCutoff: p.stats.redemptionRows - p.stats.redemptionInWindow,
    ledgerEntries: w.mem.entries(WORKSPACE).length,
  };
  return { ok: Object.keys(run.rejected).length === 0, report };
}

export async function reconcileCommand(dir: string) {
  const data = readHeyTacoExport(dir);
  const w = memoryWorld();
  const reader = w.mem.ports.reader.workspace(WORKSPACE);

  const first = plan(data, w.settings, null, []);
  const run = await importHeyTaco({ app: w.app, registrar: w.registrar, workspaceId: WORKSPACE, plan: first });
  const afterFirst = await reader.entries();

  // S105: import again, matching the members the first run created (S102), and count what it adds.
  const second = plan(data, w.settings, null, identities(first));
  await importHeyTaco({ app: w.app, registrar: w.registrar, workspaceId: WORKSPACE, plan: second });
  const afterSecond = await reader.entries();

  const balances = new Map<MemberId, Balances>();
  for (const u of first.expected) balances.set(u.memberId, await w.app.balances(WORKSPACE, u.memberId));
  const imported = (prefix: string) => afterFirst.filter((e) => e.commandKey.startsWith(prefix)).length;
  const result = reconcileImport(first, balances, {
    activityImported: imported("import:heytaco:gift:"),
    redemptionsImported: imported("import:heytaco:redemption:"),
    secondImportAdded: afterSecond.length - afterFirst.length + second.members.filter((m) => m.isNew).length,
  });
  const ledgerCheck = (await w.app.ledgerCheck(WORKSPACE)).ok;
  const s = first.stats;
  const report = {
    ok: result.ok && ledgerCheck,
    currentUsers: result.currentUsers,
    activityRowsRead: result.activityRowsRead,
    activityRowsImported: result.activityRowsImported,
    rowsByType: s.activityByType,
    identicalDuplicateRowsKept: s.duplicateRowsKept,
    redemptionRowsRead: result.redemptionRowsRead,
    redemptionRowsImported: result.redemptionRowsImported,
    redemptionsMatchedByEmailOnly: s.redemptionsMatchedByEmailOnly,
    redemptionsFulfilled: s.redemptionsFulfilled,
    redemptionsApproved: s.redemptionsApproved,
    bonusEntries: s.bonusRows,
    historicalDeactivatedMembers: s.historicalMembers,
    rejected: run.rejected,
    ledgerEntries: afterFirst.length,
    secondImportAdded: result.secondImportAdded,
    givenByCurrentMembers: result.givenByCurrentMembers,
    ledgerCheck,
    membersWithDiff: result.membersWithDiff,
  };
  return { ok: report.ok, report };
}
