import { ArrowDownLeft, ArrowUpRight, Flame, ShoppingBag } from "lucide-react";
import { Avatar, Badge, Card, CardTitle, Empty, Flash, LinkButton, Units } from "@/components/app/ui";
import { formatDate, readableText, unitsWord } from "@/lib/format";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { ENTRY_LABEL, memberHistory, memberLevel, workspaceView } from "@/server/views";

export const metadata = { title: "Home" };

// S28 allowance, S31-S33 balances, S77 level, S30 history, S80 a glance at the board.
export default async function MemberHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const p = propi();
  const [w, allowance, lvl, history, boards] = await Promise.all([
    workspaceView(viewer.ws),
    p.app.allowance(viewer.ws, viewer.memberId),
    memberLevel(viewer.ws, viewer.memberId),
    memberHistory(viewer.ws, viewer.memberId, 12),
    p.boards.visibleBoards(viewer.ws, viewer.actor),
  ]);
  const board = boards.includes("received") ? "received" : (boards[0] ?? "given");
  const top = await p.boards.leaderboard(viewer.ws, viewer.actor, { board, timeframe: { kind: "month" }, limit: 5 });
  const { currency, timezone } = w.settings;
  const { balances, level } = lvl;
  const name = viewer.session.name?.split(" ")[0] ?? w.label(viewer.memberId).split(" ")[0];
  const used = allowance.limit === 0 ? 0 : Math.min(100, Math.round((allowance.used / allowance.limit) * 100));
  const toNext = level.next ? level.next.min - level.points : 0;
  const floor = lvl.config.table.find((l) => l.level === level.level)?.min ?? 0;
  const progress = level.next ? Math.round(((level.points - floor) / (level.next.min - floor)) * 100) : 100;

  return (
    <>
      <Flash ok={sp.ok} error={sp.denied ? "That page needs a different role." : sp.error} />
      <section className="rise relative mb-6 overflow-hidden rounded-[2rem] border-2 border-ink bg-coral p-6 text-ink shadow-chunky md:p-8">
        <img src="/brand/mascot-cheer.webp" alt="" className="bob pointer-events-none absolute -right-4 -bottom-6 hidden w-44 md:block lg:w-52" />
        <p className="font-display text-lg font-extrabold">Hi {name}!</p>
        <p className="mt-1 text-sm font-semibold text-ink/75">Redeemable balance</p>
        <p className="font-display text-6xl font-black tracking-tight tabular-nums md:text-7xl" data-testid="redeemable">
          {balances.redeemable.toLocaleString("en-US")}
          <span className="ml-3 align-middle text-2xl font-extrabold">{unitsWord(balances.redeemable, currency)}</span>
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <LinkButton href="/app/shop" tone="ink">
            <ShoppingBag className="size-4" /> Spend in the shop
          </LinkButton>
          <Badge tone="sunflower">
            Level {level.level} · {level.title}
          </Badge>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-3">
        <Card className="rise md:col-span-1" style={{ ["--i" as string]: 1 }}>
          <CardTitle>Today&apos;s allowance</CardTitle>
          <p className="font-display text-4xl font-black tabular-nums">
            {allowance.remaining}
            <span className="text-xl text-ink-soft"> / {allowance.limit}</span>
          </p>
          <p className="mt-1 text-sm text-ink-soft">left to give today. Resets at midnight ({timezone}).</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-cream-deep" role="progressbar" aria-valuenow={allowance.used} aria-valuemin={0} aria-valuemax={allowance.limit} aria-label="Allowance used">
            <div className="h-full rounded-full bg-sunflower" style={{ width: `${used}%` }} />
          </div>
        </Card>
        <Card className="rise" style={{ ["--i" as string]: 2 }}>
          <CardTitle>Received</CardTitle>
          <Units n={balances.received} className="text-4xl" />
          <p className="mt-1 text-sm text-ink-soft">from teammates, all time</p>
        </Card>
        <Card className="rise" style={{ ["--i" as string]: 3 }}>
          <CardTitle>Given</CardTitle>
          <Units n={balances.given} className="text-4xl" />
          <p className="mt-1 text-sm text-ink-soft">{level.next ? `${toNext} points to ${level.next.title}` : "Top level reached"}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-deep" aria-hidden="true">
            <div className="h-full rounded-full bg-mint" style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle>My history</CardTitle>
          {history.length === 0 ? (
            <Empty title="Nothing here yet">Give your first props in Slack with {currency.primaryEmoji}.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {history.map(({ entry, delta }) => {
                const gave = entry.counterpartId === viewer.memberId && entry.memberId !== viewer.memberId;
                return (
                  <li key={entry.seq} className="flex items-center gap-3 py-3">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-full ${gave || delta < 0 ? "bg-coral-soft" : "bg-mint-soft"}`}>
                      {gave || delta < 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {gave ? `You gave ${w.label(entry.memberId)}` : entry.kind === "gift" ? `From ${w.label(entry.counterpartId)}` : ENTRY_LABEL[entry.kind]}
                      </p>
                      <p className="truncate text-xs text-ink-soft">
                        {formatDate(entry.at, timezone, true)}
                        {entry.reason ? ` · ${readableText(entry.reason)}` : ""}
                      </p>
                    </div>
                    <span className={`font-display font-extrabold tabular-nums ${gave ? "text-ink-soft" : delta < 0 ? "text-coral" : "text-ink"}`}>
                      {gave ? (entry.kind === "gift" ? `${entry.amount} given` : `${entry.amount} back`) : `${delta > 0 ? "+" : ""}${delta}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle action={<a href="/app/leaderboards" className="text-sm font-semibold text-coral hover:underline">See all</a>}>
            <span className="inline-flex items-center gap-2">
              <Flame className="size-5 text-coral" /> This month
            </span>
          </CardTitle>
          {!top.ok || top.value.length === 0 ? (
            <Empty title="The board is wide open" art="/brand/mascot-thumbs-up.webp" />
          ) : (
            <ol className="space-y-2">
              {top.value.map((r) => (
                <li key={r.memberId} className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${r.rank === 1 ? "bg-sunflower-soft" : ""}`}>
                  <span className="w-6 text-center font-display font-black text-ink-soft">{r.rank}</span>
                  <Avatar id={r.memberId} label={w.label(r.memberId)} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{w.label(r.memberId)}</span>
                  <Units n={r.score} className="text-sm" />
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-ink-soft">{board === "received" ? "Most received" : board === "given" ? "Most generous" : "Received + given"}</p>
        </Card>
      </div>
    </>
  );
}
