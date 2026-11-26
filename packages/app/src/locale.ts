// i18n S3, S4d: the language a member reads (web pages, DMs, App Home, modals, ephemeral messages,
// emails) and the one channel posts use. Rules are core's; this only loads what they need.
import { resolveMemberLocale, resolveWorkspaceLocale, type Directory, type Locale, type MemberId, type WorkspaceId } from "@propi/core";

/** Member choice → member Slack locale → workspace default → en. An unknown member gets the workspace's. */
export async function memberLocale(directory: Pick<Directory, "member" | "settings">, ws: WorkspaceId, id: MemberId): Promise<Locale> {
  const [record, settings] = await Promise.all([directory.member(ws, id), directory.settings(ws)]);
  return resolveMemberLocale({ choice: record?.language, slackLocale: record?.slackLocale, workspaceDefault: settings.language });
}

/** Channel posts: the workspace default language, en when none is set. */
export async function workspaceLocale(directory: Pick<Directory, "settings">, ws: WorkspaceId): Promise<Locale> {
  return resolveWorkspaceLocale((await directory.settings(ws)).language);
}
