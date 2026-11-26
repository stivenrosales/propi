import { rewardCatalog } from "@propi/app";
import { RewardArt } from "@/components/app/reward-art";
import { getLocale } from "@/i18n/locale";
import { shop as msgs } from "@/i18n/shop.messages";
import { Badge, Card, Empty, Flash, PageHeader, Units } from "@/components/app/ui";
import { redeemAction } from "@/server/actions/member";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { RedeemForm } from "./redeem-form";

export async function generateMetadata() {
  return { title: msgs.t(await getLocale())("title") };
}

// S44-S48, S50: the catalog of active rewards, redeemable from the web. S2: several units in one step.
export default async function Shop({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const p = propi();
  const t = msgs.t(await getLocale());
  const [rewards, balances] = await Promise.all([rewardCatalog(p.shop(viewer.ws), viewer.actor), p.app.balances(viewer.ws, viewer.memberId)]);
  const active = rewards.filter((r) => r.status === "active");
  const categories = [...new Set(active.flatMap((r) => r.categories))].sort();
  const filter = sp.category && categories.includes(sp.category) ? sp.category : null;
  const shown = filter ? active.filter((r) => r.categories.includes(filter)) : active;

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <div className="rounded-full border-2 border-ink bg-white px-4 py-2 shadow-sticker">
          <span className="mr-2 text-sm font-semibold text-ink-soft">{t("youHave")}</span>
          <Units n={balances.redeemable} />
        </div>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      {categories.length > 0 ? (
        <nav aria-label={t("categories")} className="mb-5 flex flex-wrap gap-2">
          <a href="/app/shop" className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold ${filter === null ? "border-ink bg-ink text-cream" : "border-line bg-white hover:border-ink"}`}>
            {t("all")}
          </a>
          {categories.map((c) => (
            <a key={c} href={`/app/shop?category=${encodeURIComponent(c)}`} className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold ${filter === c ? "border-ink bg-ink text-cream" : "border-line bg-white hover:border-ink"}`}>
              {c}
            </a>
          ))}
        </nav>
      ) : null}
      {shown.length === 0 ? (
        <Empty title={t("empty")} art="/brand/mascot-gift.webp">
          {t("emptyBody")}
        </Empty>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r, i) => {
            const withVariants = r.variants.length > 0;
            const stock = withVariants ? r.variants.reduce<number | null>((s, v) => (s === null || v.stock === null ? null : s + v.stock), 0) : r.stock;
            const soldOut = stock !== null && stock <= 0;
            return (
              <Card key={r.id} className="rise flex flex-col p-4 md:p-4" style={{ ["--i" as string]: i }}>
                <RewardArt id={r.id} image={r.image} categories={r.categories} title={r.title} />
                <div className="mt-4 flex items-start justify-between gap-3 px-1">
                  <h2 className="font-display text-lg leading-tight font-extrabold">{r.title}</h2>
                  <span className="shrink-0 rounded-full bg-coral-soft px-3 py-1">
                    <Units n={r.cost} className="text-sm" />
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 flex-1 px-1 text-sm text-ink-soft">{r.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 px-1">
                  {stock === null ? <Badge tone="mint">{t("unlimited")}</Badge> : soldOut ? <Badge tone="coral">{t("soldOut")}</Badge> : <Badge tone="sunflower">{t("left", { count: stock })}</Badge>}
                  {r.categories.map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                </div>
                <RedeemForm action={redeemAction} formKey={formKey()} rewardId={r.id} cost={r.cost} redeemable={balances.redeemable} stock={r.stock} variants={r.variants} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
