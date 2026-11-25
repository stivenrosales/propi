// S87: the TV display link. A stateless, unguessable token per workspace: the workspace id signed with
// SESSION_SECRET under its own purpose, so it never works as a session. Rotating SESSION_SECRET
// revokes every display link (and every session).
import { signValue, verifyValue } from "./session";

const PURPOSE = "propi.tv.v1";

export const tvToken = (secret: string, ws: string): string => signValue(secret, PURPOSE, { ws });

export function workspaceOfTvToken(secret: string, token: string | undefined | null): string | null {
  const v = verifyValue<{ ws?: unknown }>(secret, PURPOSE, token);
  return v !== null && typeof v.ws === "string" ? v.ws : null;
}
