// i18n S3, S4d: which language the server writes in. DMs, App Home, modals, ephemeral messages and
// emails to a member use `member` (their choice → Slack locale → workspace default → en); channel
// posts use `workspace` (the workspace default). Translate with a catalog: `catalog.t(locale)`.
import { memberLocale, workspaceLocale, type Directory, type Locale, type MemberId, type WorkspaceId } from "@propi/app";

export interface Locales {
  member(ws: WorkspaceId, id: MemberId): Promise<Locale>;
  workspace(ws: WorkspaceId): Promise<Locale>;
}

export function createLocales(directory: Pick<Directory, "member" | "settings">): Locales {
  return {
    member: (ws, id) => memberLocale(directory, ws, id),
    workspace: (ws) => workspaceLocale(directory, ws),
  };
}
