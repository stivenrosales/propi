// App handlers for the import commands. Each wraps a pure core/migration decider (G3).
// They plug into createApp through `options.handlers`. History keeps HeyTaco's own timestamps:
// every import handler runs at the command's `at` (clock: "command"), never at the server clock.
import { defineHandler, defineShopHandler, type RegisteredHandler } from "@propi/app";
import {
  decideImportBonus,
  decideImportGift,
  decideImportRedemption,
  type ImportGiftSnapshot,
  type ImportHeyTacoBonus,
  type ImportHeyTacoGift,
  type ImportHeyTacoRedemption,
  type ImportedBonusResult,
  type ImportedGiftResult,
  type ImportedRedemptionResult,
} from "@propi/core";

export const HEYTACO_HANDLERS: readonly RegisteredHandler[] = [
  defineHandler<ImportHeyTacoGift, ImportGiftSnapshot, ImportedGiftResult>({
    type: "ImportHeyTacoGift",
    clock: "command",
    // Adds to a receiver without reading any balance, so no lock is needed.
    locks: () => [],
    load: async (_cmd, _tx, ctx) => ({ storeMessageText: ctx.settings.storeMessageText }),
    decide: decideImportGift,
  }),
  // S104: creates a real shop redemption record, so the Tx must carry the shop store.
  defineShopHandler<ImportHeyTacoRedemption, object, ImportedRedemptionResult>({
    type: "ImportHeyTacoRedemption",
    clock: "command",
    // G4: a spend takes the member lock, the same as a live redemption.
    locks: (cmd) => [`member:${cmd.memberId}`],
    load: async () => ({}),
    decide: decideImportRedemption,
  }),
  defineHandler<ImportHeyTacoBonus, object, ImportedBonusResult>({
    type: "ImportHeyTacoBonus",
    clock: "command",
    locks: (cmd) => [`member:${cmd.memberId}`],
    load: async () => ({}),
    decide: decideImportBonus,
  }),
];
