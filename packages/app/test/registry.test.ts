import { describe, expect, test } from "vitest";
import { accept, type CommandBase, type MemberId, type PosInt } from "@propi/core";
import { createApp, defineHandler, HANDLERS } from "../src/index.ts";
import { createMemoryPorts } from "../src/testing/index.ts";
import { T0, WS, admin, key, m, setup } from "./setup.ts";

interface PayWelcome extends CommandBase {
  readonly type: "PayWelcome";
  readonly memberId: MemberId;
}

const payWelcome = defineHandler<PayWelcome, null, { paid: number }>({
  type: "PayWelcome",
  locks: (cmd) => [`member:${cmd.memberId}`],
  load: async () => null,
  decide: (_s, cmd) =>
    accept({ paid: 2 }, { entries: [{ kind: "bonus", amount: 2 as PosInt, memberId: cmd.memberId, counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "welcome" }] }),
});

describe("command registry", () => {
  test("a module adds a command through options.handlers and gets the same lock -> claim -> commit pipeline", async () => {
    const { mem } = setup();
    const app = createApp(mem.ports, { handlers: [payWelcome] });
    const cmd = { type: "PayWelcome", key: key("job:welcome:ana"), workspaceId: WS, actor: admin, at: T0, memberId: m("ana") } as const;
    expect(await app.executeAny(cmd)).toEqual({ ok: true, replayed: false, value: { paid: 2 } });
    expect(await app.executeAny(cmd)).toEqual({ ok: true, replayed: true, value: { paid: 2 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 2 });
    expect(mem.lockLog.at(-1)).toEqual(["member:ana"]);
  });

  test("registering a command type twice is refused", () => {
    expect(() => createApp(createMemoryPorts().ports, { handlers: [HANDLERS[0]!] })).toThrow(/duplicate handler/);
  });
});
