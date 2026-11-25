// S5 / S72 for a single-workspace Socket Mode app: the bot token belongs to one Slack team. On start
// the server makes sure that team has a workspace; the first start needs the installer's Slack user
// id, who becomes the first admin (core installerMember via packages/db bootstrap).
import type { Instant, WorkspaceId } from "@propi/app";
import type { Runtime } from "./runtime.ts";

export interface InstallOptions {
  readonly teamId: string;
  readonly installerUserId: string | null;
  readonly timezone: string;
  readonly now: Instant;
}

export async function ensureInstalled(rt: Runtime, o: InstallOptions): Promise<{ readonly workspaceId: WorkspaceId; readonly created: boolean; readonly reinstalled: boolean }> {
  const existing = await rt.installations.find("slack", o.teamId);
  if (existing !== null && existing.uninstalledAt === null) return { workspaceId: existing.workspaceId, created: false, reinstalled: false };
  if (existing === null && o.installerUserId === null) {
    throw new Error("first start for this Slack team: set SLACK_INSTALLER_USER_ID to the Slack user who installed the app (they become the first admin, S5)");
  }
  // A reinstall (existing but uninstalled) only clears the uninstall stamp; roles never change here.
  const r = await rt.installations.bootstrap({
    platform: "slack",
    tenantId: o.teamId,
    installerUserId: o.installerUserId ?? "",
    at: o.now,
    settings: { timezone: o.timezone },
    installation: { teamId: o.teamId },
  });
  return { workspaceId: r.workspaceId, created: r.created, reinstalled: existing !== null };
}
