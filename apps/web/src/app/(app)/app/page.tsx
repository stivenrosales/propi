import { ArrowDownLeft, ArrowUpRight, Flame, ShoppingBag } from "lucide-react";
import { Avatar, Badge, Card, CardTitle, Empty, Flash, LinkButton, Units } from "@/components/app/ui";
import { formatNumber } from "@propi/core/i18n";
import { shell } from "@/i18n/app-shell.messages";
import { home } from "@/i18n/app-home.messages";
import { getLocale } from "@/i18n/locale";
import { formatDate, readableText, unitsWord } from "@/lib/format";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { memberHistory, memberLevel, workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: home.t(await getLocale())("title") };
}

// S28 allowance, S31-S33 balances, S77 level, S30 history, S80 a glance at the board.
export default async function MemberHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const p = propi();
  const L = await getLocale();
  const t = home.t(L);
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
  // Same name as the app frame: the stored Slack profile first, then the sign-in session.
  const name = (w.members.find((m) => m.id === viewer.memberId)?.displayName ?? viewer.session.name ?? w.label(viewer.memberId)).split(" ")[0];
  const left = allowance.limit === 0 ? 0 : Math.min(100, Math.round((allowance.remaining / allowance.limit) * 100));
  const toNext = level.next ? level.next.min - level.points : 0;
  const floor = lvl.config.table.find((l) => l.level === level.level)?.min ?? 0;
  const progress = level.next ? Math.round(((level.points - floor) / (level.next.min - floor)) * 100) : 100;

  return (
    <>
      <Flash ok={sp.ok} error={sp.denied ? shell.t(L)("denied") : sp.error} />
      <section className="rise relative mb-6 overflow-hidden rounded-[2rem] border-2 border-ink bg-coral p-6 text-ink shadow-chunky md:p-8">
        <img src="/brand/mascot-cheer.webp" alt="" className="bob pointer-events-none absolute -right-4 -bottom-6 hidden w-44 md:block lg:w-52" />
        <p className="font-display text-lg font-extrabold">{t("hi", { name: name ?? "" })}</p>
        <p className="mt-1 text-sm font-semibold text-ink">{t("redeemable")}</p>
        <p className="font-display text-6xl font-black tracking-tight tabular-nums md:text-7xl" data-testid="redeemable">
          {formatNumber(L, balances.redeemable)}
          <span className="ml-3 align-middle text-2xl font-extrabold">{unitsWord(balances.redeemable, currency)}</span>
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <LinkButton href="/app/shop" tone="ink">
            <ShoppingBag className="size-4" /> {t("spend")}
          </LinkButton>
          <Badge tone="sunflower">
            {t("level", { level: level.level, title: level.title })}
          </Badge>
        </div>
        <div className="mt-4 max-w-xs">
          <p className="text-sm font-semibold">{level.next ? t("toNext", { points: toNext, title: level.next.title }) : t("topLevel")}</p>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border-2 border-ink bg-cream" role="progressbar" aria-valuenow={Math.min(100, progress)} aria-valuemin={0} aria-valuemax={100} aria-label={t("levelProgress")}>
            <div className="h-full rounded-full bg-sunflower" style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
          </div>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-3">
        <Card className="rise md:col-span-1" style={{ ["--i" as string]: 1 }}>
          <CardTitle>{t("allowance")}</CardTitle>
          <p className="font-display text-4xl font-black tabular-nums">
            {allowance.remaining}
            <span className="text-xl text-ink-soft"> / {allowance.limit}</span>
          </p>
          <p className="mt-1 text-sm text-ink-soft">{t("allowanceLeft", { timezone })}</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-cream-deep" role="progressbar" aria-valuenow={allowance.remaining} aria-valuemin={0} aria-valuemax={allowance.limit} aria-label={t("allowanceAria")}>
            <div className="h-full rounded-full bg-sunflower" style={{ width: `${left}%` }} />
          </div>
        </Card>
        <Card className="rise" style={{ ["--i" as string]: 2 }}>
          <CardTitle>{t("received")}</CardTitle>
          <Units n={balances.received} className="text-4xl" />
          <p className="mt-1 text-sm text-ink-soft">{t("receivedSub")}</p>
        </Card>
        <Card className="rise" style={{ ["--i" as string]: 3 }}>
          <CardTitle>{t("given")}</CardTitle>
          <Units n={balances.given} className="text-4xl" />
          <p className="mt-1 text-sm text-ink-soft">{t("givenSub")}</p>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle>{t("history")}</CardTitle>
          {history.length === 0 ? (
            <Empty title={t("historyEmpty")}>{t("historyEmptyBody", { emoji: currency.primaryEmoji })}</Empty>
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
                        {gave ? t("youGave", { name: w.label(entry.memberId) }) : entry.kind === "gift" ? t("from", { name: w.label(entry.counterpartId) }) : t(`entry.${entry.kind}`)}
                      </p>
                      <p className="truncate text-xs text-ink-soft">
                        {formatDate(L, entry.at, timezone, true)}
                        {entry.reason ? ` · ${readableText(entry.reason, w.label)}` : ""}
                      </p>
                    </div>
                    <span className={`font-display font-extrabold tabular-nums ${gave ? "text-ink-soft" : delta < 0 ? "text-coral-ink" : "text-ink"}`}>
                      {gave ? (entry.kind === "gift" ? t("amountGiven", { count: entry.amount }) : t("amountBack", { count: entry.amount })) : `${delta > 0 ? "+" : ""}${formatNumber(L, delta)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle action={<a href="/app/leaderboards" className="text-sm font-semibold text-coral-ink hover:underline">{t("seeAll")}</a>}>
            <span className="inline-flex items-center gap-2">
              <Flame className="size-5 text-coral" /> {t("thisMonth")}
            </span>
          </CardTitle>
          {!top.ok || top.value.length === 0 ? (
            <Empty title={t("boardEmpty")} art="/brand/mascot-thumbs-up.webp" />
          ) : (
            <ol className="space-y-2">
              {top.value.map((r) => (
                <li key={r.memberId} className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${r.rank === 1 ? "bg-sunflower-soft" : ""}`}>
                  <span className="w-6 text-center font-display font-black text-ink-soft">{r.rank}</span>
                  <Avatar id={r.memberId} label={w.label(r.memberId)} src={w.avatar(r.memberId)} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{w.label(r.memberId)}</span>
                  <Units n={r.score} className="text-sm" />
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-ink-soft">{t(`board.${board}`)}</p>
        </Card>
      </div>
    </>
  );
}
