import Image from "next/image";
import type { ReactNode } from "react";
import { Coin, Sparkle } from "@/components/ui/primitives";
import moodboard from "../../../public/brand/ui-moodboard.webp";
import cheer from "../../../public/brand/mascot-cheer.webp";

type Tile = {
  label: string;
  title: string;
  body: string;
  className: string;
  extra?: ReactNode;
  dark?: boolean;
  /** Spans both columns on the two-column (tablet) layout. */
  wide?: boolean;
};

const tiles: Tile[] = [
  {
    label: "Daily allowance",
    wide: true,
    title: "Generous, not bottomless",
    body: "Everyone gets a daily allowance that resets at midnight in your timezone. Go over it and nothing moves: you get a private note with the cost, what you have left and how to fix it.",
    className: "lg:col-span-7 bg-coral-soft",
    extra: (
      <div className="max-w-md rounded-2xl border-2 border-ink bg-cream p-4 shadow-sticker">
        <p className="text-xs font-semibold tracking-wide text-ink-soft">Only visible to you</p>
        <p className="mt-1.5 leading-snug">
          That message costs <strong className="font-semibold">6</strong> <Coin /> but you have{" "}
          <strong className="font-semibold">4</strong> left today. Mention fewer people or use fewer emoji. Your allowance
          resets at 00:00.
        </p>
      </div>
    ),
  },
  {
    label: "Reactions and edits",
    wide: true,
    title: "Every way of saying thanks counts",
    body: "React with the emoji to give. Edit a thank-you and the gift is recomputed. Delete it the same day and your allowance comes back.",
    className: "lg:col-span-5 bg-sunflower-soft",
  },
  {
    label: "Rewards shop",
    title: "A shop with approvals and refunds",
    body: "Rewards with stock, variants and an optional monthly budget. Redemptions move from pending to approved to fulfilled, and a rejection refunds the full cost in the same step.",
    className: "lg:col-span-5 bg-mint-soft",
  },
  {
    label: "Company values",
    title: "Tag what matters",
    body: "Add #ownership or a value's emoji to a gift. See who embodies which value, period by period.",
    className: "lg:col-span-3 bg-cream-deep",
  },
  {
    label: "Monthly awards",
    title: "Awards that run themselves",
    body: "Rules like “top receiver of the month gets +20” run after the period closes, announce the winners and never pay twice.",
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
    label: "Quests",
    title: "Quests for the extra mile",
    body: "Self-submitted or nominated, with optional proof and approval, plus caps, cooldowns and an open window.",
    className: "lg:col-span-4 bg-cream-deep",
  },
  {
    label: "Celebrations",
    title: "Birthdays and anniversaries",
    body: "Celebrate in a channel at local time, privately by DM, or not at all. Each person chooses. Add an automatic bonus if you like.",
    className: "lg:col-span-4 bg-sunflower-soft",
  },
  {
    label: "AI digest",
    title: "A monthly story of your team",
    body: "A digest of what people were recognized for, grouped by value, with quotes linked back to the original gifts.",
    className: "lg:col-span-4 bg-coral-soft",
  },
  {
    label: "Leaderboards and insights",
    wide: true,
    title: "See who lifts the team",
    body: "Leaderboards by received, given or combined, filtered by period, channel or value. Admins see participation, shop economy, and who has not been recognized in weeks.",
    className: "lg:col-span-8 bg-mint-soft",
    extra: (
      <figure className="overflow-hidden rounded-2xl border-2 border-ink bg-cream">
        <Image
          src={moodboard}
          alt="Design direction for the Propi web app: a leaderboard, a rewards shop and a bar chart of recognition"
          sizes="(min-width: 1024px) 720px, 100vw"
          className="h-auto w-full"
        />
        <figcaption className="border-t-2 border-ink px-4 py-2 text-xs font-medium text-ink-soft">
          Design direction for the web app
        </figcaption>
      </figure>
    ),
  },
  {
    label: "API",
    title: "A REST API with signed webhooks",
    body: "Scoped, revocable tokens. HMAC-signed webhooks with retries and event ids. Idempotency keys on writes, so a retry never doubles anything.",
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
    label: "Migration",
    wide: true,
    title: "Moving over from HeyTaco",
    body: "Import your activity, users and redemptions from HeyTaco's exports. Members match by Slack id or email, balances must equal your export, and re-running the import changes nothing.",
    className: "lg:col-span-12 bg-sunflower",
  },
];

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="bg-cream py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <h2
            id="features-title"
            className="font-display text-[clamp(2.25rem,1.5rem+3vw,3.75rem)] leading-[0.98] font-black tracking-[-0.03em] text-balance lg:col-span-7"
          >
            Everything a thank-you needs. Nothing it doesn&rsquo;t.
          </h2>
          <p className="max-w-[46ch] text-lg leading-relaxed text-ink-muted lg:col-span-5">
            The rules are written down, tested and public. No secret unlock formulas, no surprises in the ledger.
          </p>
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          {tiles.map((tile) => (
            <li
              key={tile.label}
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
              <h3 className={`mt-3 max-w-[22ch] ${tile.label === "Monthly awards" ? "pr-20" : ""} font-display text-[1.6rem] leading-[1.05] font-black tracking-tight text-balance`}>
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
