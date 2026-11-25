import { describe, expect, test } from "vitest";
import type { Actor, CommandKey, Instant, WorkspaceId } from "../../src/shared/types.ts";
import {
  decideDeleteWorkspaceData,
  decideUninstall,
  deletionConfirmation,
  exportAll,
  isPubliclyVisible,
  toCsv,
  type DeleteWorkspaceData,
  type Uninstall,
} from "../../src/privacy/index.ts";
import { NOW, lima, m, world } from "../boards/world.ts";

const WS = "ws-1" as WorkspaceId;
const boss: Actor = { kind: "member", memberId: m("boss"), role: "admin" };
const ana: Actor = { kind: "member", memberId: m("ana"), role: "member" };

describe("private-channel gifts", () => {
  test("S69: a private gift is public only when the workspace enables showing private gifts", () => {
    const data = world().give({ id: "g1", from: "ana", to: { bob: 1 }, isPrivate: true }).give({ id: "g2", from: "ana", to: { bob: 1 } }).data();
    const [priv, pub] = data.gifts;
    expect(isPubliclyVisible(priv!, data.insights)).toBe(false);
    expect(isPubliclyVisible(pub!, data.insights)).toBe(true);
    expect(isPubliclyVisible(priv!, { ...data.insights, showPrivateGifts: true })).toBe(true);
  });
});

describe("export", () => {
  test("S71: CSV fields are quoted when they contain commas, quotes or newlines", () => {
    expect(toCsv([["a", "b,c"], ['say "hi"', "line\nbreak"], ["", "x"]])).toBe('a,"b,c"\n"say ""hi""","line\nbreak"\n,x\n');
  });

  test("S71: an admin export holds every gift, ledger entry, redemption and member, with no date cap", () => {
    const data = world()
      .member("ana")
      .member("bob", "admin")
      .member("gone", "member", false)
      .give({ id: "g1", from: "ana", to: { bob: 2 }, values: ["v-own"], text: "a, \"quoted\" thanks", on: "2019-01-02" })
      .give({ id: "g2", from: "bob", to: { ana: 1 }, isPrivate: true, text: null })
      .entry("bonus", "ana", 3)
      .data();
    const redemptions = [{ id: "r1", memberId: m("ana"), rewardId: "rw1", cost: 2, state: "approved", createdAt: lima("2020-05-05") }];
    const out = exportAll({ ...data, redemptions });
    expect(out.gifts).toEqual([
      ["gift_id", "giver_id", "source", "channel_id", "private", "text", "value_ids", "allowance_day", "created_at", "message_ref"],
      ["g1", "ana", "message", "C1", "false", 'a, "quoted" thanks', "v-own", "2019-01-02", "2019-01-02T15:00:00.000Z", "ref:g1"],
      ["g2", "bob", "message", "C1", "true", "", "", "2026-11-25", "2026-11-25T15:00:00.000Z", "ref:g2"],
    ]);
    expect(out.ledger[0]).toEqual(["seq", "command_key", "ordinal", "kind", "amount", "member_id", "counterpart_id", "cause_type", "cause_id", "source", "allowance_day", "at", "reason"]);
    expect(out.ledger.slice(1)).toEqual([
      ["1", "cmd:1", "0", "gift", "2", "bob", "ana", "gift", "g1", "message", "2019-01-02", "2019-01-02T15:00:00.000Z", 'a, "quoted" thanks'],
      ["2", "cmd:2", "0", "gift", "1", "ana", "bob", "gift", "g2", "message", "2026-11-25", "2026-11-25T15:00:00.000Z", ""],
      ["3", "cmd:3", "0", "bonus", "3", "ana", "", "admin", "", "", "", "2026-11-25T15:00:00.000Z", ""],
    ]);
    expect(out.redemptions).toEqual([
      ["redemption_id", "member_id", "reward_id", "cost", "state", "created_at"],
      ["r1", "ana", "rw1", "2", "approved", "2020-05-05T15:00:00.000Z"],
    ]);
    expect(out.members).toEqual([
      ["member_id", "role", "active", "daily_limit_override"],
      ["ana", "member", "true", ""],
      ["bob", "admin", "true", ""],
      ["gone", "member", "false", ""],
    ]);
  });
});

describe("uninstall and deletion", () => {
  const base = { workspaceId: WS, at: NOW as Instant };
  const uninstall = (actor: Actor): Uninstall => ({ ...base, type: "Uninstall", key: "slack:uninstall:T1" as CommandKey, actor });
  const del = (actor: Actor, confirmation: string): DeleteWorkspaceData => ({ ...base, type: "DeleteWorkspaceData", key: "web:delete:1" as CommandKey, actor, confirmation });

  test("S72: uninstalling never deletes data", () => {
    const d = decideUninstall(null, uninstall({ kind: "system", job: "slack:app_uninstalled" }), NOW);
    expect(d).toEqual({ outcome: { ok: true, value: { dataRetained: true } }, entries: [], writes: [], events: [] });
    expect(decideUninstall(null, uninstall(ana), NOW).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
  });

  test("S72: deletion is a separate admin command that needs the explicit confirmation phrase", () => {
    expect(deletionConfirmation(WS)).toBe("delete ws-1");
    expect(decideDeleteWorkspaceData(null, del(ana, "delete ws-1"), NOW).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(decideDeleteWorkspaceData(null, del(boss, "yes"), NOW).outcome).toEqual({ ok: true, value: { status: "confirmation_required", expected: "delete ws-1" } });
    const ok = decideDeleteWorkspaceData(null, del(boss, "delete ws-1"), NOW);
    expect(ok).toEqual({ outcome: { ok: true, value: { status: "deletion_authorized", workspaceId: "ws-1" } }, entries: [], writes: [], events: [] });
  });
});
