import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";
import { Coin } from "@/components/ui/primitives";
import wave from "../../../public/brand/mascot-wave.webp";
import thumbs from "../../../public/brand/mascot-thumbs-up.webp";
import gift from "../../../public/brand/mascot-gift.webp";
import { getLocale } from "@/i18n/locale";
import { landing } from "@/i18n/landing.messages";

type Step = {
  id: string;
  title: string;
  body: string;
  mascot: StaticImageData;
  mascotAlt: string;
  tint: string;
  demo: ReactNode;
};

function steps(t: ReturnType<typeof landing.t>): Step[] {
  return [
    {
      id: "give",
      title: t("how.give.title"),
      body: t("how.give.body"),
      mascot: wave,
      mascotAlt: t("how.give.alt"),
      tint: "bg-sunflower-soft",
      demo: (
        <p className="text-[0.95rem] leading-snug">
          <span className="rounded bg-coral-soft px-1 font-medium">@ana</span>{" "}
          <span className="rounded bg-coral-soft px-1 font-medium">@diana</span> {t("how.give.demo")} <Coin /> <Coin />
        </p>
      ),
    },
    {
      id: "ledger",
      title: t("how.ledger.title"),
      body: t("how.ledger.body"),
      mascot: thumbs,
      mascotAlt: t("how.ledger.alt"),
      tint: "bg-mint-soft",
      demo: (
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="sr-only">{t("how.ledger.caption")}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">{t("how.ledger.entry")}</th>
              <th scope="col">{t("how.ledger.amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-dashed divide-line">
            {[
              [t("how.ledger.gift"), "+3"],
              [t("how.ledger.bonus"), "+5"],
              [t("how.ledger.redemption"), "−12"],
            ].map(([label, amount]) => (
              <tr key={label}>
                <td className="py-1.5 text-ink-muted">{label}</td>
                <td
                  className={`py-1.5 text-right font-display font-black ${amount?.startsWith("+") ? "text-ink" : "text-ink-soft"}`}
                >
                  {amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      id: "shop",
      title: t("how.shop.title"),
      body: t("how.shop.body"),
      mascot: gift,
      mascotAlt: t("how.shop.alt"),
      tint: "bg-coral-soft",
      demo: (
        <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold" aria-label={t("how.shop.states")}>
          <li className="rounded-full border-2 border-ink bg-cream px-2.5 py-1">{t("how.shop.pending")}</li>
          <li aria-hidden="true">→</li>
          <li className="rounded-full border-2 border-ink bg-sunflower px-2.5 py-1">{t("how.shop.approved")}</li>
          <li aria-hidden="true">→</li>
          <li className="rounded-full border-2 border-ink bg-mint px-2.5 py-1">{t("how.shop.fulfilled")}</li>
        </ol>
      ),
    },
  ];
}

export async function HowItWorks() {
  const t = landing.t(await getLocale());
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
        <div className="max-w-2xl">
          <h2 id="how-title" className="font-display text-[clamp(2.25rem,1.5rem+3vw,3.75rem)] leading-[0.98] font-black tracking-[-0.03em] text-balance">
            {t("how.title")}
          </h2>
        </div>

        <ol className="relative mt-16 grid gap-14 md:grid-cols-3 md:gap-8 lg:gap-12">
          {/* Dashed trail connecting the steps on wide screens */}
          <svg
            aria-hidden="true"
            viewBox="0 0 1000 120"
            preserveAspectRatio="none"
            className="pointer-events-none absolute top-24 left-[10%] hidden h-32 w-[80%] text-ink/25 md:block"
          >
            <path
              d="M0 30 C 180 120, 320 -20, 500 60 S 820 130, 1000 50"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="2 12"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {steps(t).map((step, i) => (
            <li
              key={step.id}
              className={`reveal relative ${i === 1 ? "md:mt-16" : ""} ${i === 2 ? "md:mt-32" : ""}`}
            >
              <div className="relative flex items-end gap-4">
                <div className={`relative grid size-36 shrink-0 place-items-center rounded-full ${step.tint} sm:size-40`}>
                  <Image
                    src={step.mascot}
                    alt={step.mascotAlt}
                    sizes="160px"
                    className="bob h-auto w-[82%]"
                    style={{ "--i": i } as React.CSSProperties}
                  />
                </div>
                <span
                  aria-hidden="true"
                  className="font-display text-[5.5rem] leading-[0.75] font-black text-coral [-webkit-text-stroke:3px_var(--ink)]"
                >
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-7 font-display text-2xl font-black tracking-tight sm:text-[1.7rem]">
                <span className="sr-only">{t("how.step", { n: String(i + 1) })} </span>
                {step.title}
              </h3>
              <p className="mt-3 max-w-[34ch] leading-relaxed text-ink-muted">{step.body}</p>
              <div className="mt-6 max-w-[22rem] rounded-2xl border-2 border-ink bg-cream p-3.5 shadow-sticker">{step.demo}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
