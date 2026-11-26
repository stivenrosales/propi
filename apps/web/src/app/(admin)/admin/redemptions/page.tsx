import { Check, PackageCheck, Undo2, X } from "lucide-react";
import { redemptionQuantity, type Redemption } from "@propi/core";
import { RewardArt } from "@/components/app/reward-art";
import { StateBadge } from "@/components/app/state-badge";
import { Avatar, Badge, Button, Card, CardTitle, Empty, Flash, Input, KeyInput, PageHeader, Table, Td, Units } from "@/components/app/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { transitionRedemptionAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { unitsTitle } from "@/server/shop-view";
import { workspaceView } from "@/server/views";

export const metadata = { title: "Redemption queue" };

function Move({ id, transition, label, tone, icon, reason = false }: { id: string; transition: string; label: string; tone: "coral" | "mint" | "cream" | "danger"; icon: React.ReactNode; reason?: boolean }) {
  return (
    <form action={transitionRedemptionAction} className="flex items-center gap-1.5">
      <KeyInput value={formKey()} />
      <input type="hidden" name="redemptionId" value={id} />
      <input type="hidden" name="transition" value={transition} />
      {reason ? <Input name="reason" placeholder="Reason (optional)" aria-label="Reason" className="h-9 min-h-9 w-40 text-sm" /> : null}
      <Button size="sm" tone={tone} confirm={tone === "danger" ? `${label}? Click again` : undefined}>
        {icon} {label}
      </Button>
    </form>
  );
}

// S49-S53: approvers and admins move redemptions; every transition is TransitionRedemption (S6).
export default async function RedemptionQueue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("approver");
  const sp = await searchParams;
  const shop = propi().shop(viewer.ws);
  const [all, rewards, w] = await Promise.all([shop.redemptions(), shop.rewards(), workspaceView(viewer.ws)]);
  const byId = new Map(rewards.map((r) => [r.id, r]));
  const pending = all.filter((r) => r.state === "pending").sort((a, b) => a.createdAt - b.createdAt);
  const approved = all.filter((r) => r.state === "approved").sort((a, b) => a.createdAt - b.createdAt);
  const done = all.filter((r) => !["pending", "approved"].includes(r.state)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 25);
  const who = (r: Redemption) => (r.memberId ? w.label(r.memberId) : "Group reward");
  // S2: a batch reads "3 × Mug"; the cost shown is the total for all units.
  const title = (r: Redemption) => (r.rewardId ? unitsTitle(byId.get(r.rewardId)?.title ?? "Reward", redemptionQuantity(r)) : "Group reward");

  const Row = ({ r, actions }: { r: Redemption; actions: React.ReactNode }) => {
    const reward = r.rewardId ? byId.get(r.rewardId) : undefined;
    return (
      <li className="flex flex-wrap items-center gap-4 py-4">
        <div className="w-14 shrink-0">
          <RewardArt id={r.rewardId ?? r.id} image={reward?.image ?? null} categories={reward?.categories ?? []} title={reward?.title ?? ""} className="h-14" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-extrabold">{title(r)}</p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            {r.memberId ? <Avatar id={r.memberId} label={who(r)} src={w.avatar(r.memberId)} size="sm" /> : null}
            {who(r)} · {formatDate(r.createdAt, w.settings.timezone, true)}
            {typeof r.onBehalfOf === "object" && "admin" in r.onBehalfOf ? <Badge>on behalf</Badge> : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Units n={r.cost} />
          {r.internalCost ? <span className="text-xs text-ink-soft">{formatMoney(r.internalCost.minor, r.internalCost.currency)}</span> : null}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Redemption queue" eyebrow="Review">
        <Badge tone="sunflower">{pending.length} waiting</Badge>
        <Badge tone="coral">{approved.length} to fulfil</Badge>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5">
        <Card>
          <CardTitle>Waiting for approval</CardTitle>
          {pending.length === 0 ? (
            <Empty title="Inbox zero" art="/brand/mascot-thumbs-up.webp">No redemptions are waiting.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  actions={
                    <>
                      <Move id={r.id} transition="approve" label="Approve" tone="mint" icon={<Check className="size-4" />} />
                      <Move id={r.id} transition="reject" label="Reject" tone="danger" icon={<X className="size-4" />} reason />
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Approved, to fulfil</CardTitle>
          {approved.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing to deliver right now.</p>
          ) : (
            <ul className="divide-y divide-line">
              {approved.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  actions={
                    <>
                      <Move id={r.id} transition="fulfil" label="Mark fulfilled" tone="coral" icon={<PackageCheck className="size-4" />} />
                      <Move id={r.id} transition="cancel" label="Cancel" tone="danger" icon={<Undo2 className="size-4" />} reason />
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Recently closed</CardTitle>
          <Table head={["Reward", "Member", "Cost", "State", "Updated"]}>
            {done.map((r) => (
              <tr key={r.id}>
                <Td className="font-semibold">{title(r)}</Td>
                <Td>{who(r)}</Td>
                <Td><Units n={r.cost} className="text-sm" /></Td>
                <Td><StateBadge state={r.state} /></Td>
                <Td className="text-ink-soft">{formatDate(r.updatedAt, w.settings.timezone)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
