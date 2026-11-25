// S69: private-channel gifts are stored but hidden from public feeds and profiles unless enabled.
import type { Gift } from "../giving/types.ts";
import type { InsightsSettings } from "../boards/source.ts";

export function isPubliclyVisible(gift: Pick<Gift, "isPrivate">, s: Pick<InsightsSettings, "showPrivateGifts">): boolean {
  return !gift.isPrivate || s.showPrivateGifts;
}
