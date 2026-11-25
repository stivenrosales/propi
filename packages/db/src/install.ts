// S5 workspace bootstrap and the platform installation store (S72: an uninstall keeps data).
//
// `bootstrap` turns a platform install (Slack OAuth "installation") into a workspace whose installer
// is the first admin. It is idempotent per (platform, tenant): one advisory lock serializes installs
// of the same tenant, the first creates workspace + admin member + identity + installation row, and
// every later call (a retry, a reinstall, a second installer) only refreshes the stored installation.
// Roles are never changed here: S5 makes only the first installer an admin (core installerMember).
//
// Workspace creation precedes every command (command_log rows reference the workspace), so this is
// configuration setup like createDbAdmin, not a ledger command.
import {
  decideLinkIdentity,
  defaultSettings,
  installerMember,
  type Ids,
  type Instant,
  type MemberId,
  type Platform,
  type WorkspaceId,
  type WorkspaceSettings,
} from "@propi/core";
import { Prisma, type PrismaClient } from "./client.ts";
import type { SecretCipher } from "./crypto.ts";
import { uuidv7Ids } from "./runtime.ts";
import { settingsToJson, toJson } from "./settings-json.ts";

export interface InstallInput {
  readonly platform: Platform;
  /** Slack team id (or Teams tenant id). */
  readonly tenantId: string;
  /** The platform user who installed the app; becomes the first admin of a new workspace. */
  readonly installerUserId: string;
  readonly at: Instant;
  /** Settings for a new workspace (e.g. its timezone); ignored when the workspace exists. */
  readonly settings?: Partial<WorkspaceSettings>;
  /** The platform's installation object (bot token etc.); stored encrypted. */
  readonly installation?: unknown;
}

export interface BootstrapResult {
  readonly workspaceId: WorkspaceId;
  /** True only for the call that created the workspace. */
  readonly created: boolean;
  /** The installer's member when their identity is linked (always on creation), else null. */
  readonly installerMemberId: MemberId | null;
}

export interface StoredInstallation {
  readonly platform: Platform;
  readonly tenantId: string;
  readonly workspaceId: WorkspaceId;
  /** The decrypted installation object, or null when none was stored. */
  readonly installation: unknown;
  readonly installedAt: Instant;
  readonly uninstalledAt: Instant | null;
}

export interface DbInstallations {
  bootstrap(input: InstallInput): Promise<BootstrapResult>;
  find(platform: Platform, tenantId: string): Promise<StoredInstallation | null>;
  /** S72: stamps the uninstall; the workspace and its data stay. */
  markUninstalled(platform: Platform, tenantId: string, at: Instant): Promise<void>;
}

/** The associated data that binds an encrypted installation to its row. */
export const installationContext = (platform: Platform, tenantId: string): string => `install:${platform}:${tenantId}`;

/** The system actor that links the installer's identity (the platform OAuth proved who they are). */
const INSTALL_ACTOR = { kind: "system", job: "install" } as const;

export function createDbInstallations(prisma: PrismaClient, opts: { readonly cipher: SecretCipher; readonly ids?: Ids }): DbInstallations {
  const ids = opts.ids ?? uuidv7Ids;
  const seal = (input: InstallInput): string | null =>
    input.installation === undefined ? null : opts.cipher.encrypt(toJson(input.installation), installationContext(input.platform, input.tenantId));

  return {
    async bootstrap(input) {
      const { platform, tenantId } = input;
      const at = new Date(input.at);
      const dataEnc = seal(input);
      return prisma.$transaction(
        async (db) => {
          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`install|${platform}|${tenantId}`}, 0))`;
          const [existing] = await db.$queryRaw<{ workspace_id: string }[]>`
            SELECT workspace_id FROM installation WHERE platform = ${platform} AND tenant_id = ${tenantId}`;

          if (existing !== undefined) {
            const ws = existing.workspace_id as WorkspaceId;
            await db.$executeRaw`
              UPDATE installation SET data_enc = COALESCE(${dataEnc}, data_enc), uninstalled_at = NULL
              WHERE platform = ${platform} AND tenant_id = ${tenantId}`;
            const [linked] = await db.$queryRaw<{ member_id: string }[]>`
              SELECT member_id FROM identity
              WHERE workspace_id = ${ws} AND platform = ${platform} AND platform_team_id = ${tenantId} AND platform_user_id = ${input.installerUserId}`;
            return { workspaceId: ws, created: false, installerMemberId: (linked?.member_id ?? null) as MemberId | null };
          }

          const ws = ids.next("workspace") as WorkspaceId;
          const settings = defaultSettings(input.settings ?? {});
          await db.$executeRaw`INSERT INTO workspace (id, settings, created_at) VALUES (${ws}, ${toJson(settingsToJson(settings))}::jsonb, ${at})`;

          const admin = installerMember(ids.next("member") as MemberId);
          await db.$executeRaw`
            INSERT INTO member (workspace_id, id, role, active, daily_limit_override, created_at)
            VALUES (${ws}, ${admin.id}, ${admin.role}, ${admin.active}, ${admin.dailyLimitOverride}, ${at})`;

          const link = decideLinkIdentity(
            { existing: null, member: admin },
            { actor: INSTALL_ACTOR, workspaceId: ws, identity: { platform, tenantId, userId: input.installerUserId }, memberId: admin.id },
          );
          if (!link.ok) throw new Error(`installer identity refused: ${link.error.code}`);
          const i = link.value.identity;
          await db.$executeRaw`
            INSERT INTO identity (workspace_id, platform, platform_team_id, platform_user_id, member_id)
            VALUES (${i.workspaceId}, ${i.platform}, ${i.tenantId}, ${i.userId}, ${i.memberId})`;

          await db.$executeRaw`
            INSERT INTO installation (platform, tenant_id, workspace_id, data_enc, installed_at)
            VALUES (${platform}, ${tenantId}, ${ws}, ${dataEnc}, ${at})`;
          return { workspaceId: ws, created: true, installerMemberId: admin.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },

    async find(platform, tenantId) {
      const [row] = await prisma.$queryRaw<{ workspace_id: string; data_enc: string | null; installed_at: Date; uninstalled_at: Date | null }[]>`
        SELECT workspace_id, data_enc, installed_at, uninstalled_at FROM installation WHERE platform = ${platform} AND tenant_id = ${tenantId}`;
      if (row === undefined) return null;
      return {
        platform,
        tenantId,
        workspaceId: row.workspace_id as WorkspaceId,
        installation: row.data_enc === null ? null : (JSON.parse(opts.cipher.decrypt(row.data_enc, installationContext(platform, tenantId))) as unknown),
        installedAt: row.installed_at.getTime() as Instant,
        uninstalledAt: row.uninstalled_at === null ? null : (row.uninstalled_at.getTime() as Instant),
      };
    },

    async markUninstalled(platform, tenantId, at) {
      await prisma.$executeRaw`
        UPDATE installation SET uninstalled_at = ${new Date(at)} WHERE platform = ${platform} AND tenant_id = ${tenantId} AND uninstalled_at IS NULL`;
    },
  };
}
