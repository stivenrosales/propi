// S108: the gift-card relay. Fulfilled gift-card redemptions are issued through the provider,
// idempotently per redemption, then recorded through a normal command.
import type { Ports, WorkspaceId } from "@propi/core";
import type { App } from "../create-app.ts";
import { asShop } from "./handlers.ts";
import type { GiftCardProvider, RecordGiftCardIssued } from "./core.ts";

export async function issueGiftCards(app: App, ports: Ports, provider: GiftCardProvider, ws: WorkspaceId): Promise<{ readonly issued: number }> {
  const shop = asShop(ports.reader.workspace(ws));
  let issued = 0;
  for (const r of await shop.redemptions()) {
    if (!r.giftCard || r.state !== "fulfilled" || r.cardIssued || r.memberId === null || r.internalCost === null) continue;
    const at = ports.clock.now();
    const res = await provider.issue({ key: `giftcard:${r.id}`, workspaceId: ws, redemptionId: r.id, memberId: r.memberId, value: r.internalCost, at });
    if (!res.ok) continue;
    const cmd: RecordGiftCardIssued = {
      type: "RecordGiftCardIssued",
      key: `giftcard:${r.id}:issued` as RecordGiftCardIssued["key"],
      workspaceId: ws,
      actor: { kind: "system", job: "giftcards" },
      at,
      redemptionId: r.id,
    };
    const out = await app.executeAny(cmd);
    if (out.ok && !out.replayed) issued++;
  }
  return { issued };
}
