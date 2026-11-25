import { AlertTriangle, Repeat2, Tv } from "lucide-react";
import { localDate, type Instant } from "@propi/core";
import { BarChart } from "@/components/app/bar-chart";
import { Avatar, Badge, Card, CardTitle, Empty, PageHeader, Select, Stat, Table, Td, Units, Button } from "@/components/app/ui";
import { formatMoney } from "@/lib/format";
import { parseTimeframe, TIMEFRAMES } from "@/lib/timeframe";
import { requireViewer } from "@/server/auth";
import { sessionSecret } from "@/server/env";
import { propi } from "@/server/propi";
import { tvToken } from "@/server/tv-token";
import { dailyGiftUnits, workspaceView } from "@/server/views";

export const metadata = { title: "Insights" };

// S88 team metrics, S89 isolation alerts, S90 reciprocity, S43 values report.
export default async function Insights({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  const timeframe = parseTimeframe(sp.timeframe, sp.from, sp.to);
  const w = await workspaceView(viewer.ws);
  const shop = p.shop(viewer.ws);
  const shopSettings = await shop.shopSettings();
  const month = localDate(Date.now() as Instant, w.settings.timezone).slice(0, 7);
  const budget = shopSettings.monthlyBudget ? { usedCents: await shop.budgetSpent(month), limitCents: shopSettings.monthlyBudget.minor } : null;
  const [metrics, isolation, reciprocity, values, valueNames, daily] = await Promise.all([
    p.metrics.adminMetrics(viewer.ws, viewer.actor, timeframe, budget),
    p.metrics.isolationAlerts(viewer.ws),
    p.metrics.reciprocity(viewer.ws, viewer.actor, timeframe),
    p.boards.valuesReport(viewer.ws, timeframe),
    p.ports.directory.values(viewer.ws),
    dailyGiftUnits(viewer.ws, w.settings.timezone, 30),
  ]);
  if (!metrics.ok) return <Empty title="Insights are for admins" />;
  const m = metrics.value;
  const valueName = new Map(valueNames.map((v) => [v.id, v.name]));
  const byValue = new Map<string, { memberId: string; units: number }[]>();
  for (const r of values) byValue.set(r.valueId, [...(byValue.get(r.valueId) ?? []), { memberId: r.memberId, units: r.units }]);
  const cur = shopSettings.monthlyBudget?.currency ?? "USD";

  return (
    <>
      <PageHeader title="Insights" eyebrow="Admin">
        <form className="flex items-center gap-2">
          <Select name="timeframe" defaultValue={timeframe.kind} aria-label="Timeframe" className="w-36">
            {TIMEFRAMES.filter((t) => t !== "custom").map((t) => (
              <option key={t} value={t}>{t === "all" ? "All time" : t[0]!.toUpperCase() + t.slice(1)}</option>
            ))}
          </Select>
          <Button size="sm" tone="ink">Apply</Button>
        </form>
        <a href={`/tv?display=${encodeURIComponent(tvToken(sessionSecret(), viewer.ws))}`} target="_blank" rel="noreferrer" className="lift inline-flex min-h-9 items-center gap-2 rounded-full border-2 border-ink bg-sunflower px-4 text-sm font-extrabold shadow-sticker">
          <Tv className="size-4" /> Open TV mode
        </a>
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Gifts" value={m.gifts.toLocaleString("en-US")} sub={`${m.giftsPerCapita.toFixed(1)} per person`} tone="coral" />
        <Stat label="Units given" value={<Units n={m.units} />} sub={`${m.unitsPerCapita.toFixed(1)} per person`} />
        <Stat label="Members who gave" value={`${Math.round(m.giversPercent)}%`} sub={`of ${m.activeMembers} active members`} tone="mint" />
        <Stat label="Gifts with a value" value={`${Math.round(m.valueTaggedPercent)}%`} sub={m.topValues[0] ? `Top: ${valueName.get(m.topValues[0].valueId) ?? "—"}` : "No values yet"} tone="sunflower" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardTitle>Units given, last 30 days</CardTitle>
          <BarChart data={daily} label="Net units given per day over the last 30 days" />
        </Card>
        <Card>
          <CardTitle>Shop economy</CardTitle>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-mint-soft p-3"><dt className="text-ink-soft">Earned</dt><dd className="font-display text-xl font-black">{m.economy.earned}</dd></div>
            <div className="rounded-2xl bg-coral-soft p-3"><dt className="text-ink-soft">Spent</dt><dd className="font-display text-xl font-black">{m.economy.spent}</dd></div>
            <div className="rounded-2xl bg-cream-deep p-3"><dt className="text-ink-soft">Deducted</dt><dd className="font-display text-xl font-black">{m.economy.deducted}</dd></div>
            <div className="rounded-2xl bg-sunflower-soft p-3"><dt className="text-ink-soft">Outstanding</dt><dd className="font-display text-xl font-black">{m.economy.outstanding}</dd></div>
          </dl>
          {budget ? (
            <div className="mt-4">
              <p className="text-sm font-semibold">Budget {month}: {formatMoney(budget.usedCents, cur)} of {formatMoney(budget.limitCents, cur)}</p>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-cream-deep">
                <div className="h-full rounded-full bg-coral" style={{ width: `${Math.min(100, Math.round((budget.usedCents / Math.max(1, budget.limitCents)) * 100))}%` }} />
              </div>
            </div>
          ) : <p className="mt-4 text-sm text-ink-soft">No monthly budget set.</p>}
        </Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Badge tone={isolation.isolated.length > 0 ? "coral" : "mint"}>{isolation.isolated.length}</Badge>}>
            <span className="inline-flex items-center gap-2"><AlertTriangle className="size-5 text-coral" /> Isolation alerts</span>
          </CardTitle>
          {isolation.isolated.length === 0 ? (
            <p className="text-sm text-ink-soft">Everyone received props recently.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {isolation.isolated.map((id) => (
                <li key={id} className="flex items-center gap-2 rounded-full bg-coral-soft py-1 pr-3 pl-1 text-sm font-semibold"><Avatar id={id} label={w.label(id)} size="sm" /> {w.label(id)}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-soft">Active members who received nothing in the last few weeks (S89).</p>
        </Card>
        <Card>
          <CardTitle><span className="inline-flex items-center gap-2"><Repeat2 className="size-5" /> Reciprocity review</span></CardTitle>
          {!reciprocity.ok || reciprocity.value.length === 0 ? (
            <p className="text-sm text-ink-soft">No pairs flagged for this period. Nothing is ever blocked automatically.</p>
          ) : (
            <Table head={["Pair", "Gifts", "Shares"]}>
              {reciprocity.value.map((f) => (
                <tr key={`${f.a}-${f.b}`}>
                  <Td>{w.label(f.a)} ⇄ {w.label(f.b)}</Td>
                  <Td>{f.gifts}</Td>
                  <Td>{Math.round(f.aSharePercent)}% / {Math.round(f.bSharePercent)}%</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Card className="mt-5">
        <CardTitle>Who embodies which value</CardTitle>
        {byValue.size === 0 ? (
          <p className="text-sm text-ink-soft">No tagged gifts in this period.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[...byValue].map(([valueId, rows]) => (
              <div key={valueId} className="rounded-3xl bg-cream/70 p-4">
                <p className="font-display text-lg font-extrabold">{valueName.get(valueId as never) ?? valueId}</p>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {rows.sort((a, b) => b.units - a.units).slice(0, 3).map((r) => (
                    <li key={r.memberId} className="flex justify-between gap-2"><span className="truncate">{w.label(r.memberId)}</span><Units n={r.units} className="text-sm" /></li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
