// App handlers for the import commands. Each wraps a pure core/migration decider (G3).
// They plug into createApp through `options.handlers`.
import { defineHandler, type RegisteredHandler } from "@propi/app";
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
} from "../../core/src/migration/index.ts";

export const HEYTACO_HANDLERS: readonly RegisteredHandler[] = [
  defineHandler<ImportHeyTacoGift, ImportGiftSnapshot, ImportedGiftResult>({
    type: "ImportHeyTacoGift",
    // Adds to a receiver without reading any balance, so no lock is needed.
    locks: () => [],
    load: async (_cmd, _tx, ctx) => ({ storeMessageText: ctx.settings.storeMessageText }),
    decide: decideImportGift,
  }),
  defineHandler<ImportHeyTacoRedemption, object, ImportedRedemptionResult>({
    type: "ImportHeyTacoRedemption",
    // G4: a spend takes the member lock, the same as a live redemption.
    locks: (cmd) => [`member:${cmd.memberId}`],
    load: async () => ({}),
    decide: decideImportRedemption,
  }),
  defineHandler<ImportHeyTacoBonus, object, ImportedBonusResult>({
    type: "ImportHeyTacoBonus",
    locks: (cmd) => [`member:${cmd.memberId}`],
    load: async () => ({}),
    decide: decideImportBonus,
  }),
];
