// The signed-in viewer for pages and server actions. The role comes from the directory on every
// request, never from the cookie.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor, MemberId, Role, WorkspaceId } from "@propi/core";
import { sessionSecret } from "./env";
import { propi } from "./propi";
import { decideAccess, type Need } from "./roles";
import { readSession, SESSION_COOKIE, type Session } from "./session";

export interface Viewer {
  readonly ws: WorkspaceId;
  readonly memberId: MemberId;
  readonly role: Role;
  readonly active: boolean;
  readonly actor: Actor;
  readonly session: Session;
}

export async function currentViewer(): Promise<Viewer | null> {
  const store = await cookies();
  const session = readSession(sessionSecret(), store.get(SESSION_COOKIE)?.value);
  if (session === null) return null;
  const ws = session.ws as WorkspaceId;
  const record = await propi().ports.directory.member(ws, session.member as MemberId);
  if (record === null) return null;
  return { ws, memberId: record.id, role: record.role, active: record.active, actor: { kind: "member", memberId: record.id, role: record.role }, session };
}

/** For pages: redirects when the viewer may not see the page. */
export async function requireViewer(need: Need = "member"): Promise<Viewer> {
  const viewer = await currentViewer();
  const access = decideAccess(viewer, need);
  if (!access.ok || viewer === null) redirect(access.redirect ?? "/signin");
  return viewer;
}

/** For server actions: throws instead of redirecting, so a forged form post never runs. */
export async function actionViewer(need: Need = "member"): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!decideAccess(viewer, need).ok || viewer === null) throw new Error("forbidden");
  return viewer;
}

/** What the app frame shows about the viewer. */
export async function shellViewer(viewer: Viewer): Promise<{ memberId: string; role: Role; label: string; picture: string | null }> {
  const [{ memberLabel }, { getLocale }] = await Promise.all([import("@/lib/format"), import("@/i18n/locale")]);
  const record = await propi().ports.directory.member(viewer.ws, viewer.memberId);
  return {
    memberId: viewer.memberId,
    role: viewer.role,
    label: record?.displayName || viewer.session.name || memberLabel(viewer.memberId, await getLocale()),
    picture: record?.avatarUrl || viewer.session.picture,
  };
}
