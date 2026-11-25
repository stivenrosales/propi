// S6: a member's Slack display name and avatar are stored and read back through the directory.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { defaultSettings, type MemberId, type WorkspaceId } from "@propi/core";
import { createDbAdmin, createDbPorts, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";

let db: TestDatabase | undefined;
let pg: PrismaClient | undefined;

beforeAll(async () => {
  if (hasDatabase) {
    db = await createTestDatabase();
    pg = db.client();
  }
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

const WS = "ws-profile" as WorkspaceId;
const ana = "ana-id" as MemberId;

describe.skipIf(!hasDatabase)("member profile (S6)", () => {
  test("a new member has no profile; setMemberProfile stores name and avatar for member() and members()", async () => {
    const admin = createDbAdmin(pg!);
    const { directory } = createDbPorts(pg!);
    await admin.addWorkspace(WS, defaultSettings());
    await admin.addMember(WS, { id: ana, role: "member", active: true, dailyLimitOverride: null });
    expect(await directory.member(WS, ana)).toEqual({ id: ana, role: "member", active: true, dailyLimitOverride: null });

    await admin.setMemberProfile(WS, ana, { displayName: "Ana Torres", avatarUrl: "https://avatars.slack-edge.com/ana_192.png" });
    expect(await directory.member(WS, ana)).toEqual({
      id: ana,
      role: "member",
      active: true,
      dailyLimitOverride: null,
      displayName: "Ana Torres",
      avatarUrl: "https://avatars.slack-edge.com/ana_192.png",
    });
    expect((await directory.members(WS)).find((r) => r.id === ana)).toMatchObject({ displayName: "Ana Torres" });
  });

  test("changing the role keeps the profile; an unknown member is a no-op", async () => {
    const admin = createDbAdmin(pg!);
    const { directory } = createDbPorts(pg!);
    await admin.addMember(WS, { id: ana, role: "approver", active: true, dailyLimitOverride: null });
    expect(await directory.member(WS, ana)).toMatchObject({ role: "approver", displayName: "Ana Torres" });
    await admin.setMemberProfile(WS, "ghost" as MemberId, { displayName: "Ghost", avatarUrl: null });
    expect(await directory.member(WS, "ghost" as MemberId)).toBeNull();
  });
});
