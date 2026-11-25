import { describe, expect, test } from "vitest";
import type { WorkspaceId } from "../src/shared/types.ts";
import { decideLinkIdentity, identitiesOf, identityKey, resolveIdentity, type PlatformIdentity } from "../src/identity/index.ts";
import { m, memberActor, record } from "./fixtures.ts";

const WS = "ws-1" as WorkspaceId;
const slack = { platform: "slack", tenantId: "T1", userId: "U1" } as const;
const teams = { platform: "teams", tenantId: "tn", userId: "29:1" } as const;
const system = { kind: "system", job: "oauth" } as const;

describe("S107: platform identities", () => {
  test("S107: an admin or a verified sign-in links identities from several platforms to one member", () => {
    const a = decideLinkIdentity({ existing: null, member: record("ana") }, { actor: memberActor("boss", "admin"), workspaceId: WS, identity: slack, memberId: m("ana") });
    expect(a).toEqual({ ok: true, value: { identity: { workspaceId: WS, ...slack, memberId: "ana" }, changed: true } });
    const b = decideLinkIdentity({ existing: null, member: record("ana") }, { actor: system, workspaceId: WS, identity: teams, memberId: m("ana") });
    expect(b).toMatchObject({ ok: true, value: { changed: true } });
    expect(decideLinkIdentity({ existing: null, member: record("ana") }, { actor: memberActor("ana"), workspaceId: WS, identity: slack, memberId: m("ana") })).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(decideLinkIdentity({ existing: null, member: null }, { actor: system, workspaceId: WS, identity: slack, memberId: m("ghost") })).toEqual({ ok: false, error: { code: "unknown_member", memberId: "ghost" } });
  });

  test("S107: one identity belongs to one member; relinking to the same member is a no-op", () => {
    const linked: PlatformIdentity = { workspaceId: WS, ...slack, memberId: m("ana") };
    expect(decideLinkIdentity({ existing: linked, member: record("ana") }, { actor: system, workspaceId: WS, identity: slack, memberId: m("ana") })).toEqual({ ok: true, value: { identity: linked, changed: false } });
    expect(decideLinkIdentity({ existing: linked, member: record("bob") }, { actor: system, workspaceId: WS, identity: slack, memberId: m("bob") })).toEqual({ ok: false, error: { code: "identity_taken", memberId: "ana" } });
  });

  test("S107: every linked identity resolves to the same member, so the balance is shared", () => {
    const all: PlatformIdentity[] = [
      { workspaceId: WS, ...slack, memberId: m("ana") },
      { workspaceId: WS, ...teams, memberId: m("ana") },
      { workspaceId: WS, platform: "slack", tenantId: "T1", userId: "U2", memberId: m("bob") },
    ];
    expect(resolveIdentity(all, slack)).toBe("ana");
    expect(resolveIdentity(all, teams)).toBe("ana");
    expect(resolveIdentity(all, { platform: "teams", tenantId: "tn", userId: "U1" })).toBeNull();
    expect(identitiesOf(all, m("ana")).map(identityKey)).toEqual(["slack:T1:U1", "teams:tn:29:1"]);
  });
});
