import { Badge, Button, Card, CardTitle, Flash, PageHeader, Stat } from "@/components/app/ui";
import { formatDate } from "@propi/core/i18n";
import { billingPage } from "@/i18n/admin-billing.messages";
import { getLocale } from "@/i18n/locale";
import { requireViewer } from "@/server/auth";
import { billingView } from "@/server/billing";
import { manageBillingAction, upgradeToProAction } from "@/server/billing-actions";

export async function generateMetadata() {
  return { title: billingPage.t(await getLocale())("title") };
}

// S6, S7: the workspace plan, active members against the Free limit, upgrade and manage through Polar.
export default async function Billing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const { configured, plan, subscription } = await billingView(viewer.ws);
  const sub = subscription;
  const L = await getLocale();
  const t = billingPage.t(L);
  const date = (ms: number) => formatDate(L, ms, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
      <Flash ok={sp.ok} error={sp.error} />
      {!configured ? (
        <Card>
          <CardTitle>{t("notConfigured")}</CardTitle>
          <p className="text-sm text-ink-soft">{t("notConfiguredBody")}</p>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardTitle action={<Badge tone={plan.plan === "free" ? "muted" : "mint"}>{t(`plan.${plan.plan}`)}</Badge>}>{t("yourPlan")}</CardTitle>
            <div className={sub !== null && plan.plan === "pro" ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
              <Stat label={t("activeMembers")} value={plan.activeMembers} sub={plan.limit === null ? t("noLimit") : t("freeLimit", { limit: plan.limit })} tone={plan.overLimit ? "coral" : "white"} />
              {sub !== null && plan.plan === "pro" ? (
                <Stat label={sub.cancelAtPeriodEnd ? t("endsOn") : t("renewsOn")} value={sub.currentPeriodEnd === null ? "—" : date(sub.currentPeriodEnd)} sub={sub.seats === null ? undefined : t("seats", { count: sub.seats })} />
              ) : null}
            </div>
            {plan.overLimit ? (
              <p className="mt-4 text-sm font-semibold text-coral-ink">
                {t("over")}
              </p>
            ) : null}
            <p className="mt-4 text-sm text-ink-soft">{t("explain")}</p>
          </Card>

          <Card>
            <CardTitle>{t("manage")}</CardTitle>
            <div className="flex flex-wrap gap-3">
              {plan.plan === "free" ? (
                <form action={upgradeToProAction}>
                  <Button>{t("upgrade")}</Button>
                </form>
              ) : null}
              {sub !== null ? (
                <form action={manageBillingAction}>
                  <Button tone="cream">{t("manageBilling")}</Button>
                </form>
              ) : null}
              {plan.plan === "comped" ? <p className="text-sm text-ink-soft">{t("comped")}</p> : null}
            </div>
            <p className="mt-4 text-sm text-ink-soft">{t("polar")}</p>
          </Card>
        </div>
      )}
    </>
  );
}
