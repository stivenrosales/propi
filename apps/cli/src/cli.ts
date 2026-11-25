// propi CLI: argument parsing and exit codes (0 ok, 1 check failed or input unreadable, 2 usage error).
import { HEYTACO_EXPORT_TIMEZONE, zonedLocalToInstant } from "@propi/heytaco";
import type { Instant } from "@propi/app";
import { importCommand, reconcileCommand } from "./heytaco.ts";

export const USAGE = `usage: propi <command>

commands:
  import <dir> [--until <timestamp>]  import a HeyTaco export directory (S101-S105)
                                      --until keeps rows strictly before the timestamp (G6):
                                      ISO 8601 with a zone, or "YYYY-MM-DD HH:MM:SS" in ${HEYTACO_EXPORT_TIMEZONE}
  reconcile <dir>                     import twice and check: 0 diffs on received, given and redeemable
                                      for current users, rows read = rows imported, re-import adds 0 (S103, G9)

Storage is in memory for now: nothing is persisted. Output is aggregate counts only.`;

type Out = (line: string) => void;

class UsageError extends Error {}

/** ISO with an explicit zone, or a bare local timestamp read in the export timezone. */
export function parseUntil(raw: string): Instant {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw.trim())) return zonedLocalToInstant(raw, HEYTACO_EXPORT_TIMEZONE);
  const t = /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(raw.trim()) ? Date.parse(raw) : Number.NaN;
  if (Number.isNaN(t)) throw new UsageError(`invalid --until "${raw}": use ISO 8601 with a zone or "YYYY-MM-DD HH:MM:SS"`);
  return t as Instant;
}

function parseArgs(argv: readonly string[]): { command: string; dir: string; until: Instant | null } {
  const [command, ...rest] = argv;
  let dir: string | null = null;
  let until: Instant | null = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (a === "--until") {
      if (command !== "import") throw new UsageError("--until is only valid for import");
      const v = rest[++i];
      if (v === undefined) throw new UsageError("--until needs a timestamp");
      until = parseUntil(v);
    } else if (a.startsWith("-")) throw new UsageError(`unknown option ${a}`);
    else if (dir === null) dir = a;
    else throw new UsageError(`unexpected argument ${a}`);
  }
  if (command !== "import" && command !== "reconcile") throw new UsageError(command ? `unknown command ${command}` : "missing command");
  if (dir === null) throw new UsageError(`${command} needs an export directory`);
  return { command, dir, until };
}

export async function runCli(argv: readonly string[], out: Out, err: Out): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(USAGE);
    return 0;
  }
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`propi: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  try {
    const { ok, report } = args.command === "import" ? await importCommand(args.dir, args.until) : await reconcileCommand(args.dir);
    out(JSON.stringify(report, null, 2));
    return ok ? 0 : 1;
  } catch (e) {
    err(`propi: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
