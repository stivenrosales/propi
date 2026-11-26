import { Crown } from "lucide-react";
import { resolveWorkspaceLocale, type WorkspaceId } from "@propi/core";
import { getLocale } from "@/i18n/locale";
import { tvPage } from "@/i18n/tv.messages";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Avatar, Coin } from "@/components/app/ui";
import { formatDate, readableText } from "@/lib/format";
import { sessionSecret } from "@/server/env";
import { propi } from "@/server/propi";
import { workspaceOfTvToken } from "@/server/tv-token";
import { workspaceView } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "TV", robots: { index: false, follow: false } };

// S87: the live feed and the leaderboard for an office screen. No sign-in: the unguessable display
// token in the link names the workspace. Giver mode (S81) applies as for any member.
export default async function Tv({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = workspaceOfTvToken(sessionSecret(), sp.display);
  if (ws === null) {
    const t = tvPage.t(await getLocale());
    return (
      <main className="grid min-h-dvh place-items-center bg-ink p-8 text-center text-cream">
        <div>
          <img src="/brand/propi-logo-on-dark.svg" alt="Propi" className="mx-auto h-12" />
          <p className="mt-6 text-lg">{t("invalid")}</p>
        </div>
      </main>
    );
  }
  // A shared office screen speaks the workspace default language, like channel posts (S3).
  const settings = await propi().ports.directory.settings(ws as WorkspaceId);
  const L = resolveWorkspaceLocale(settings.language);
  const t = tvPage.t(L);
  const [tv, w] = await Promise.all([propi().boards.tvDisplay(ws as WorkspaceId, { feedSize: 8, boardSize: 8 }), workspaceView(ws as WorkspaceId, L)]);
  const { currency, timezone } = w.settings;
  const kind = tv.timeframe.kind;
  const period = kind === "today" || kind === "week" || kind === "month" || kind === "year" ? kind : "year";

  return (
    <main className="relative min-h-dvh overflow-hidden bg-ink p-6 text-cream md:p-10">
      <AutoRefresh seconds={30} />
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 -right-40 size-[34rem] rounded-full bg-coral/25 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -left-24 size-[30rem] rounded-full bg-mint/20 blur-3xl" />
      <header className="relative flex items-center justify-between">
        <img src="/brand/propi-logo-on-dark.svg" alt="Propi" className="h-10 md:h-12" />
        <p className="font-display text-lg font-extrabold text-sunflower">{t("live", { period: t(`period.${period}`) })}</p>
      </header>
      <div className="relative mt-8 grid gap-8 xl:grid-cols-[1fr_1.3fr]">
        <section>
          <h1 className="font-display text-4xl font-black md:text-5xl">{t(`board.${tv.board}`)}</h1>
          <ol className="mt-6 space-y-3">
            {tv.leaderboard.map((r) => (
              <li key={r.memberId} className={`flex items-center gap-4 rounded-3xl px-5 py-4 ${r.rank === 1 ? "bg-sunflower text-ink" : "bg-ink-raised"}`}>
                <span className="w-10 text-center font-display text-3xl font-black">{r.rank === 1 ? <Crown className="mx-auto size-8" fill="currentColor" /> : r.rank}</span>
                <Avatar id={r.memberId} label={w.label(r.memberId)} src={w.avatar(r.memberId)} size="lg" />
                <span className="min-w-0 flex-1 truncate font-display text-2xl font-extrabold">{w.label(r.memberId)}</span>
                <span className="inline-flex items-center gap-2 font-display text-3xl font-black tabular-nums"><Coin className="size-8" />{r.score}</span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2 className="font-display text-4xl font-black md:text-5xl">{t("fresh", { currency: currency.plural })}</h2>
          <ul className="mt-6 space-y-3">
            {tv.feed.map((g) => (
              <li key={g.giftId} className="rounded-3xl bg-cream p-5 text-ink">
                <div className="flex items-center gap-3">
                  <Avatar id={g.giver} label={w.label(g.giver)} src={w.avatar(g.giver)} />
                  <p className="min-w-0 flex-1 text-lg">
                    <strong>{w.label(g.giver)}</strong> → <strong>{g.receivers.map((r) => w.label(r.memberId)).join(", ")}</strong>
                  </p>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-soft px-3 py-1 font-display text-xl font-black"><Coin />{g.units}</span>
                </div>
                {g.text ? <p className="mt-2 line-clamp-2 text-ink-soft">{readableText(g.text, w.label)}</p> : null}
                <p className="mt-1 text-xs text-ink-soft">{formatDate(L, g.at, timezone, true)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
