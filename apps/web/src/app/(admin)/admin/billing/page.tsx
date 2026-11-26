import { Badge, Button, Card, CardTitle, Flash, PageHeader, Stat } from "@/components/app/ui";
import { requireViewer } from "@/server/auth";
import { billingView } from "@/server/billing";
import { manageBillingAction, upgradeToProAction } from "@/server/billing-actions";

export const metadata = { title: "Billing" };

const PLAN_LABEL = { free: "Free", pro: "Pro", comped: "Pro (complimentary)" } as const;
const date = (t: number) => new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// S6, S7: the workspace plan, active members against the Free limit, upgrade and manage through Polar.
export default async function Billing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const { configured, plan, subscription } = await billingView(viewer.ws);
  const sub = subscription;

  return (
    <>
      <PageHeader title="Billing" eyebrow="Admin" />
      <Flash ok={sp.ok} error={sp.error} />
      {!configured ? (
        <Card>
          <CardTitle>Billing is not configured</CardTitle>
          <p className="text-sm text-ink-soft">This Propi server has no billing provider set up, so every feature is available with no member limit.</p>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardTitle action={<Badge tone={plan.plan === "free" ? "muted" : "mint"}>{PLAN_LABEL[plan.plan]}</Badge>}>Your plan</CardTitle>
            <div className={sub !== null && plan.plan === "pro" ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
              <Stat label="Active members" value={plan.activeMembers} sub={plan.limit === null ? "No member limit" : `Free plan limit: ${plan.limit}`} tone={plan.overLimit ? "coral" : "white"} />
              {sub !== null && plan.plan === "pro" ? (
                <Stat label={sub.cancelAtPeriodEnd ? "Ends on" : "Renews on"} value={sub.currentPeriodEnd === null ? "—" : date(sub.currentPeriodEnd)} sub={sub.seats === null ? undefined : `${sub.seats} paid seats`} />
              ) : null}
            </div>
            {plan.overLimit ? (
              <p className="mt-4 text-sm font-semibold text-coral-ink">
                Your workspace is over the Free plan limit. Recognition keeps working, but the reward shop takes no new redemptions until you upgrade to Pro.
              </p>
            ) : null}
            <p className="mt-4 text-sm text-ink-soft">Active members are members who are not deactivated. Pro is billed per active member per month.</p>
          </Card>

          <Card>
            <CardTitle>Manage</CardTitle>
            <div className="flex flex-wrap gap-3">
              {plan.plan === "free" ? (
                <form action={upgradeToProAction}>
                  <Button>Upgrade to Pro</Button>
                </form>
              ) : null}
              {sub !== null ? (
                <form action={manageBillingAction}>
                  <Button tone="cream">Manage billing</Button>
                </form>
              ) : null}
              {plan.plan === "comped" ? <p className="text-sm text-ink-soft">This workspace has Pro at no cost.</p> : null}
            </div>
            <p className="mt-4 text-sm text-ink-soft">Payments, invoices, seats and cancellation are handled by Polar.</p>
          </Card>
        </div>
      )}
    </>
  );
}
