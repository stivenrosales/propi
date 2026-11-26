import { Crown, Trophy } from "lucide-react";
import type { ValueId } from "@propi/core";
import { Avatar, Button, Card, Empty, Field, Input, PageHeader, Select, Units } from "@/components/app/ui";
import { shell } from "@/i18n/app-shell.messages";
import { boardsPage } from "@/i18n/leaderboards.messages";
import { getLocale } from "@/i18n/locale";
import { parseBoard, parseTimeframe, TIMEFRAMES } from "@/lib/timeframe";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: boardsPage.t(await getLocale())("title") };
}

const CROWN = ["text-sunflower", "text-ink-soft", "text-coral"];

// S80-S82: received / given / combined boards, any timeframe, by channel and by value. Giver mode
// (S81) limits which boards members may open; core refuses the others.
export default async function Leaderboards({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const p = propi();
  const L = await getLocale();
  const t = boardsPage.t(L);
  const st = shell.t(L);
  const [visible, w, values, gifts] = await Promise.all([
    p.boards.visibleBoards(viewer.ws, viewer.actor),
    workspaceView(viewer.ws),
    p.ports.directory.values(viewer.ws),
    p.insights.source.gifts(viewer.ws),
  ]);
  const board = parseBoard(sp.board, visible);
  const timeframe = parseTimeframe(sp.timeframe, sp.from, sp.to);
  const channels = [...new Set(gifts.filter((g) => !g.isPrivate).map((g) => g.channelId))].sort();
  const channelId = sp.channel && channels.includes(sp.channel) ? sp.channel : null;
  const valueId = sp.value && values.some((v) => v.id === sp.value) ? (sp.value as ValueId) : null;
  const rows = await p.boards.leaderboard(viewer.ws, viewer.actor, { board, timeframe, channelId, valueId, limit: 50 });

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
      <Card className="mb-5">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label={t("board")}>
            <Select name="board" defaultValue={board}>
              {visible.map((b) => (
                <option key={b} value={b}>{st(`board.${b}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={st("timeframe.label")}>
            <Select name="timeframe" defaultValue={timeframe.kind}>
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{st(`timeframe.${tf}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("channel")}>
            <Select name="channel" defaultValue={channelId ?? ""}>
              <option value="">{t("allChannels")}</option>
              {channels.map((c) => (
                <option key={c} value={c}>#{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("value")}>
            <Select name="value" defaultValue={valueId ?? ""}>
              <option value="">{t("allValues")}</option>
              {values.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("from")} hint={t("customOnly")}>
            <Input type="date" name="from" defaultValue={timeframe.kind === "custom" ? timeframe.from : ""} />
          </Field>
          <Field label={t("to")} hint={t("customOnly")}>
            <Input type="date" name="to" defaultValue={timeframe.kind === "custom" ? timeframe.to : ""} />
          </Field>
          <Button tone="ink" className="self-end sm:col-span-2 sm:justify-self-start lg:mb-[1.375rem]">{st("apply")}</Button>
        </form>
      </Card>
      <Card>
        {!rows.ok ? (
          <Empty title={t("hidden")}>{t("hiddenBody")}</Empty>
        ) : rows.value.length === 0 ? (
          <Empty title={t("empty")} art="/brand/mascot-thumbs-up.webp" />
        ) : (
          <ol className="space-y-1.5">
            {rows.value.map((r) => (
              <li key={r.memberId} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 md:gap-4 md:px-4 ${r.rank === 1 ? "bg-sunflower-soft" : r.memberId === viewer.memberId ? "bg-coral-soft" : "hover:bg-cream/70"}`}>
                <span className="grid w-8 place-items-center font-display text-lg font-black text-ink-soft">
                  {r.rank <= 3 ? <Crown className={`size-6 ${CROWN[r.rank - 1]}`} fill="currentColor" stroke="var(--ink)" strokeWidth={1.5} aria-label={t("rank", { rank: r.rank })} /> : r.rank}
                </span>
                <Avatar id={r.memberId} label={w.label(r.memberId)} src={w.avatar(r.memberId)} />
                <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
                  <span className="truncate">{w.label(r.memberId)}</span>
                  {r.memberId === viewer.memberId ? <span className="shrink-0 text-xs text-coral-ink">{t("you")}</span> : null}
                </span>
                <span className="hidden text-xs text-ink-soft sm:inline">
                  {t("inOut", { received: r.received, given: r.given })}
                </span>
                <span className="inline-flex min-w-16 justify-center rounded-full bg-white px-3 py-1 shadow-[inset_0_0_0_1px_var(--line)]">
                  <Units n={r.score} />
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-soft">
          <Trophy className="size-3.5" /> {t("footnote")}
        </p>
      </Card>
    </>
  );
}
