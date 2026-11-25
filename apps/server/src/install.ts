// S4 legacy self-host bootstrap. Workspaces normally arrive through the web's "Add to Slack" (OAuth v2,
// apps/web/src/app/slack), which stores each bot token in its installation. A server started with
// SLACK_BOT_TOKEN (a manual install, e.g. Pearson before the hosted version) adopts that token into its
// team's installation once, so it keeps working without reinstalling:
//   - the installation exists without a stored token → the env token is stored (adopted);
//   - the installation already has a token → nothing changes (the stored one wins);
//   - no installation and SLACK_INSTALLER_USER_ID set → the workspace is created, installer first admin (S5);
//   - no installation and no installer → skipped (install from the web instead).
// Every write goes through installations.bootstrap: it never changes roles.
import type { Instant, WorkspaceId } from "@propi/app";
import { slackBotCredentials, type SlackInstallationData } from "@propi/db";
import type { Runtime } from "./runtime.ts";

export interface AdoptOptions {
  readonly teamId: string;
  readonly botToken: string;
  readonly botUserId: string;
  readonly installerUserId: string | null;
  /** Timezone of a newly created workspace (S3). */
  readonly timezone: string;
  readonly now: Instant;
}

export type AdoptOutcome = "created" | "adopted" | "kept" | "skipped";

export async function adoptEnvToken(rt: Pick<Runtime, "installations">, o: AdoptOptions): Promise<{ readonly outcome: AdoptOutcome; readonly workspaceId: WorkspaceId | null }> {
  const existing = await rt.installations.find("slack", o.teamId);
  if (existing !== null && slackBotCredentials(existing.installation) !== null) return { outcome: "kept", workspaceId: existing.workspaceId };
  if (existing === null && o.installerUserId === null) return { outcome: "skipped", workspaceId: null };
  const installation: SlackInstallationData = {
    teamId: o.teamId,
    teamName: null,
    botToken: o.botToken,
    botUserId: o.botUserId,
    scopes: [],
    installerUserId: o.installerUserId,
  };
  const r = await rt.installations.bootstrap({
    platform: "slack",
    tenantId: o.teamId,
    installerUserId: o.installerUserId ?? "",
    at: o.now,
    settings: { timezone: o.timezone },
    installation,
  });
  return { outcome: existing === null ? "created" : "adopted", workspaceId: r.workspaceId };
}
