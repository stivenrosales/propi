// S3: the only way to get a Slack client. Every workspace is served with the bot token of its own
// installation (decrypted from `installation.data_enc`), so no code path can send with another
// workspace's token. Credentials are cached briefly per team and dropped on uninstall/token revoke.
import type { WorkspaceId } from "@propi/app";
import { slackBotCredentials } from "@propi/db";
import type { Runtime } from "./runtime.ts";
import type { SlackApi } from "./slack-api.ts";

export interface SlackAuth {
  readonly teamId: string;
  readonly workspaceId: WorkspaceId;
  readonly botToken: string;
  readonly botUserId: string | null;
}

export interface SlackGateway {
  /** The bot credentials of the team's active installation, or null (not installed, uninstalled, no token). */
  auth(team: string): Promise<SlackAuth | null>;
  /** The Slack client of a team's active installation, or null. */
  forTeam(team: string): Promise<SlackApi | null>;
  /** The Slack client of the workspace's active installation, or null. */
  forWorkspace(ws: WorkspaceId): Promise<SlackApi | null>;
  /** Drops cached credentials of one team (or all), e.g. after an uninstall. */
  invalidate(team?: string): void;
}

export function installationGateway(
  rt: Pick<Runtime, "installations">,
  clientFor: (botToken: string) => SlackApi,
  opts: { readonly ttlMs?: number; readonly now?: () => number } = {},
): SlackGateway {
  const ttlMs = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const auths = new Map<string, { readonly at: number; readonly auth: SlackAuth }>();
  const teams = new Map<WorkspaceId, string>();
  const clients = new Map<string, SlackApi>();

  async function auth(team: string): Promise<SlackAuth | null> {
    const hit = auths.get(team);
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.auth;
    auths.delete(team);
    const inst = await rt.installations.find("slack", team);
    if (inst === null || inst.uninstalledAt !== null) return null;
    const creds = slackBotCredentials(inst.installation);
    if (creds === null) return null;
    const a: SlackAuth = { teamId: team, workspaceId: inst.workspaceId, ...creds };
    auths.set(team, { at: now(), auth: a });
    teams.set(inst.workspaceId, team);
    return a;
  }

  async function forTeam(team: string): Promise<SlackApi | null> {
    const a = await auth(team);
    if (a === null) return null;
    let c = clients.get(a.botToken);
    if (c === undefined) {
      c = clientFor(a.botToken);
      clients.set(a.botToken, c);
    }
    return c;
  }

  return {
    auth,
    forTeam,
    async forWorkspace(ws) {
      const known = teams.get(ws);
      if (known !== undefined) return forTeam(known);
      const inst = await rt.installations.byWorkspace("slack", ws);
      if (inst === null) return null;
      teams.set(ws, inst.tenantId);
      return forTeam(inst.tenantId);
    },
    invalidate(team) {
      if (team === undefined) auths.clear();
      else auths.delete(team);
      clients.clear();
    },
  };
}
