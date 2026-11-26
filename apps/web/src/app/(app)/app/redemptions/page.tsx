import { redemptionQuantity } from "@propi/core";
import { RewardArt } from "@/components/app/reward-art";
import { StateBadge } from "@/components/app/state-badge";
import { Card, Empty, PageHeader, Units } from "@/components/app/ui";
import { getLocale } from "@/i18n/locale";
import { shop as msgs } from "@/i18n/shop.messages";
import { formatDate } from "@/lib/format";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { unitsTitle } from "@/server/shop-view";

export async function generateMetadata() {
  return { title: msgs.t(await getLocale())("mine.title") };
}

// S49-S54: the member's own redemptions and where each one stands. S2: batches show their quantity.
export default async function MyRedemptions() {
  const viewer = await requireViewer();
  const shop = propi().shop(viewer.ws);
  const L = await getLocale();
  const t = msgs.t(L);
  const [all, rewards, settings] = await Promise.all([shop.redemptions(), shop.rewards(), propi().ports.directory.settings(viewer.ws)]);
  const byId = new Map(rewards.map((r) => [r.id, r]));
  const mine = all.filter((r) => r.memberId === viewer.memberId).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <>
      <PageHeader title={t("mine.title")} eyebrow={t("mine.eyebrow")} />
      {mine.length === 0 ? (
        <Empty title={t("mine.empty")} art="/brand/mascot-gift.webp">
          {t("mine.emptyBefore")} <a href="/app/shop" className="font-semibold text-coral-ink underline">{t("mine.emptyLink")}</a>
          {t("mine.emptyAfter")}
        </Empty>
      ) : (
        <div className="grid gap-4">
          {mine.map((r) => {
            const reward = r.rewardId ? byId.get(r.rewardId) : undefined;
            return (
              <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4 md:p-4">
                <div className="w-20 shrink-0">
                  <RewardArt id={r.rewardId ?? r.id} image={reward?.image ?? null} categories={reward?.categories ?? []} title={reward?.title ?? ""} className="h-20" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-extrabold">{unitsTitle(reward?.title ?? t("reward"), redemptionQuantity(r))}</p>
                  <p className="text-sm text-ink-soft">
                    {formatDate(L, r.createdAt, settings.timezone)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                  {r.state === "approved" && reward?.instructions ? <p className="mt-1 text-sm">{reward.instructions}</p> : null}
                </div>
                <Units n={r.cost} />
                <StateBadge state={r.state} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
