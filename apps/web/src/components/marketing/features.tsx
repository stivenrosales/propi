import Image from "next/image";
import type { ReactNode } from "react";
import { Coin, Sparkle } from "@/components/ui/primitives";
import moodboard from "../../../public/brand/ui-moodboard.webp";
import cheer from "../../../public/brand/mascot-cheer.webp";
import { rich } from "./rich-text";
import { getLocale } from "@/i18n/locale";
import { landing } from "@/i18n/landing.messages";

type Tile = {
  id: string;
  label: string;
  title: string;
  body: string;
  className: string;
  extra?: ReactNode;
  dark?: boolean;
  /** Spans both columns on the two-column (tablet) layout. */
  wide?: boolean;
};

function tiles(t: ReturnType<typeof landing.t>): Tile[] {
  return [
    {
      id: "allowance",
      label: t("features.allowance.label"),
      wide: true,
      title: t("features.allowance.title"),
      body: t("features.allowance.body"),
      className: "lg:col-span-7 bg-coral-soft",
      extra: (
        <div className="max-w-md rounded-2xl border-2 border-ink bg-cream p-4 shadow-sticker">
          <p className="text-xs font-semibold tracking-wide text-ink-soft">{t("features.allowance.private")}</p>
          <p className="mt-1.5 leading-snug">
            {rich(t("features.allowance.note", { cost: "{cost}", coin: "{coin}", left: "{left}" }), {
              cost: <strong className="font-semibold">6</strong>,
              coin: <Coin />,
              left: <strong className="font-semibold">4</strong>,
            })}
          </p>
        </div>
      ),
    },
    {
      id: "reactions",
      label: t("features.reactions.label"),
      wide: true,
      title: t("features.reactions.title"),
      body: t("features.reactions.body"),
      className: "lg:col-span-5 bg-sunflower-soft",
    },
    {
      id: "shop",
      label: t("features.shop.label"),
      title: t("features.shop.title"),
      body: t("features.shop.body"),
      className: "lg:col-span-5 bg-mint-soft",
    },
    {
      id: "values",
      label: t("features.values.label"),
      title: t("features.values.title"),
      body: t("features.values.body"),
      className: "lg:col-span-3 bg-cream-deep",
    },
    {
      id: "awards",
      label: t("features.awards.label"),
      title: t("features.awards.title"),
      body: t("features.awards.body"),
      className: "lg:col-span-4 bg-ink text-cream",
      dark: true,
      extra: (
        <Image
          src={cheer}
          alt=""
          sizes="120px"
          className="bob pointer-events-none absolute top-4 right-4 h-auto w-20 sm:w-24"
        />
      ),
    },
    {
      id: "quests",
      label: t("features.quests.label"),
      title: t("features.quests.title"),
      body: t("features.quests.body"),
      className: "lg:col-span-4 bg-cream-deep",
    },
    {
      id: "celebrations",
      label: t("features.celebrations.label"),
      title: t("features.celebrations.title"),
      body: t("features.celebrations.body"),
      className: "lg:col-span-4 bg-sunflower-soft",
    },
    {
      id: "digest",
      label: t("features.digest.label"),
      title: t("features.digest.title"),
      body: t("features.digest.body"),
      className: "lg:col-span-4 bg-coral-soft",
    },
    {
      id: "insights",
      label: t("features.insights.label"),
      wide: true,
      title: t("features.insights.title"),
      body: t("features.insights.body"),
      className: "lg:col-span-8 bg-mint-soft",
      extra: (
        <figure className="overflow-hidden rounded-2xl border-2 border-ink bg-cream">
          <Image
            src={moodboard}
            alt={t("features.insights.alt")}
            sizes="(min-width: 1024px) 720px, 100vw"
            className="h-auto w-full"
          />
          <figcaption className="border-t-2 border-ink px-4 py-2 text-xs font-medium text-ink-soft">
            {t("features.insights.caption")}
          </figcaption>
        </figure>
      ),
    },
    {
      id: "api",
      label: t("features.api.label"),
      title: t("features.api.title"),
      body: t("features.api.body"),
      className: "lg:col-span-4 bg-ink text-cream",
      dark: true,
      extra: (
        <pre className="overflow-x-auto lg:mt-auto rounded-xl bg-ink-raised p-4 text-[0.8rem] leading-relaxed text-cream/90">
          <code>{`event   redemption.approved
  id      evt_…   (dedupe on this)
  signed  HMAC, per-endpoint secret
  retry   with backoff`}</code>
        </pre>
      ),
    },
    {
      id: "migration",
      label: t("features.migration.label"),
      wide: true,
      title: t("features.migration.title"),
      body: t("features.migration.body"),
      className: "lg:col-span-12 bg-sunflower",
    },
  ];
}

export async function Features() {
  const t = landing.t(await getLocale());
  return (
    <section id="features" aria-labelledby="features-title" className="bg-cream py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <h2
            id="features-title"
            className="font-display text-[clamp(2.25rem,1.5rem+3vw,3.75rem)] leading-[0.98] font-black tracking-[-0.03em] text-balance lg:col-span-7"
          >
            {t("features.title")}
          </h2>
          <p className="max-w-[46ch] text-lg leading-relaxed text-ink-muted lg:col-span-5">
            {t("features.lead")}
          </p>
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          {tiles(t).map((tile) => (
            <li
              key={tile.id}
              className={`reveal relative flex flex-col rounded-[1.75rem] border-2 border-ink p-6 sm:p-7 ${tile.className} ${tile.wide ? "sm:col-span-2" : ""}`}
            >
              <p
                className={`inline-flex w-fit items-center gap-1.5 text-xs font-bold tracking-[0.08em] uppercase ${
                  tile.dark ? "text-sunflower" : "text-ink-soft"
                }`}
              >
                <Sparkle className={`size-3 ${tile.dark ? "text-sunflower" : "text-coral"}`} />
                {tile.label}
              </p>
              <h3 className={`mt-3 max-w-[22ch] ${tile.id === "awards" ? "pr-20" : ""} font-display text-[1.6rem] leading-[1.05] font-black tracking-tight text-balance`}>
                {tile.title}
              </h3>
              <p className={`mt-3 max-w-[60ch] not-last:mb-6 leading-relaxed ${tile.dark ? "text-cream/80" : "text-ink-muted"}`}>
                {tile.body}
              </p>
              {tile.extra}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
