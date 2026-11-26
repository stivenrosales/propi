import Image from "next/image";
import { site } from "@/content/site";
import { ButtonLink, Coin, GitHubIcon, SlackIcon, Sparkle } from "@/components/ui/primitives";
import { getLocale } from "@/i18n/locale";
import { landing } from "@/i18n/landing.messages";
import hero from "../../../public/brand/hero.webp";

// A real-looking gift message, built from the spec's own example shape.
function GiftExample({ t, className }: { t: ReturnType<typeof landing.t>; className: string }) {
  return (
    <figure
      className={`rise max-w-[25rem] rounded-2xl border-2 border-ink bg-cream p-4 shadow-sticker ${className}`}
      style={{ "--i": 4 } as React.CSSProperties}
    >
      <figcaption className="sr-only">{t("hero.example.caption")}</figcaption>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-mint font-display text-sm font-black">
          J
        </span>
        <div className="min-w-0 text-[0.95rem] leading-snug">
          <p className="font-semibold">
            Jo <span className="ml-1 text-xs font-normal text-ink-soft">#team-ops</span>
          </p>
          <p className="mt-0.5">
            <span className="rounded bg-coral-soft px-1 font-medium">@lin</span> {t("hero.example.message")}{" "}
            <span className="whitespace-nowrap">
              <Coin /> <Coin /> <Coin />
            </span>
          </p>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-2 border-t-2 border-dashed border-line pt-3 text-sm text-ink-soft">
        <span className="size-2 rounded-full bg-mint" aria-hidden="true" />
        {t("hero.example.receipt")}
      </p>
    </figure>
  );
}

export async function Hero() {
  const t = landing.t(await getLocale());
  const free = site.pricing.freeActiveMembers;
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div className="mx-auto max-w-[1240px] px-4 pt-12 sm:px-6 sm:pt-16 lg:grid lg:grid-cols-[minmax(0,33rem)_minmax(0,1fr)] lg:items-center lg:gap-10 lg:px-10 lg:pt-16 lg:pb-24 xl:grid-cols-[minmax(0,37rem)_minmax(0,1fr)]">
        <div className="max-w-[34rem] lg:max-w-[33rem] xl:max-w-[37rem]">
          <p className="rise inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-1.5 text-[0.8rem] font-semibold tracking-wide text-cream" style={{ "--i": 0 } as React.CSSProperties}>
            <Sparkle className="twinkle size-3.5 text-sunflower" />
            {t("hero.badge")}
          </p>

          <h1
            id="hero-title"
            className="rise mt-6 font-display text-[clamp(2.9rem,1rem+4.6vw,4.6rem)] leading-[0.92] font-black tracking-[-0.035em] text-balance"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            <span className="block">{t("hero.title.1")}</span>
            <span className="relative inline-block whitespace-nowrap">
              {t("hero.title.2")}{" "}
              <span className="relative inline-block">
                {t("hero.title.3")}
                <svg
                  viewBox="0 0 220 24"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="absolute -bottom-[0.12em] left-0 h-[0.22em] w-full text-coral"
                >
                  <path d="M4 16C52 6 120 4 216 10" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
                </svg>
              </span>
            </span>
          </h1>

          <p
            className="rise mt-7 max-w-[30rem] text-lg leading-relaxed text-ink-muted text-pretty sm:text-xl"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            {t("hero.lead", { free })}
          </p>

          <p
            className="rise mt-5 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border-2 border-ink bg-mint-soft px-3.5 py-2 text-[0.95rem] font-semibold"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            <span className="size-2 shrink-0 rounded-full bg-mint ring-2 ring-ink" aria-hidden="true" />
            <span>{t("hero.hosted", { domain: site.hostedDomain })}</span>
            <span aria-hidden="true" className="hidden text-ink-soft sm:inline">·</span>
            <span className="basis-full pl-4 sm:basis-auto sm:pl-0">{t("hero.free", { free })}</span>
          </p>

          <div className="rise mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap" style={{ "--i": 3 } as React.CSSProperties}>
            <ButtonLink href={site.installHref} tone="coral">
              <SlackIcon className="size-5" />
              {t("hero.addToSlack")}
            </ButtonLink>
            <ButtonLink href={site.signInHref} tone="cream">
              {t("hero.signIn")}
            </ButtonLink>
          </div>
          <p className="rise mt-4 text-[0.95rem] text-ink-muted" style={{ "--i": 3 } as React.CSSProperties}>
            {t("hero.selfHostPrompt")}{" "}
            <a href="#self-host" className="inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-coral decoration-2 underline-offset-4 hover:decoration-ink">
              <GitHubIcon className="size-4" />
              {t("hero.selfHostLink")}
            </a>
          </p>

          <GiftExample t={t} className="mt-10 lg:hidden" />

        </div>

        {/* Illustration: right column on wide screens, centred on the copy. The source has an empty
            left third, so it is cropped to the people and its edges fade into the page. */}
        <div className="relative hidden lg:-mr-10 lg:block xl:-mr-16">
          <div className="hero-art pointer-events-none">
          <Image
            src={hero}
            alt={t("hero.art.alt")}
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="aspect-[5/4] w-full object-cover object-right [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent_0%,black_10%),linear-gradient(to_bottom,black_80%,transparent_100%)]"
          />
          </div>
          {/* On wide screens the example sits on the illustration, so the copy column ends at the buttons. */}
          <GiftExample t={t} className="absolute -bottom-14 -left-6 w-[21rem] -rotate-2" />
        </div>
      </div>

      {/* Mobile and tablet illustration */}
      <div className="relative mt-10 lg:hidden">
        <Image
          src={hero}
          alt={t("hero.art.alt")}
          sizes="100vw"
          className="aspect-[4/3] w-full object-cover object-[78%_center] sm:aspect-[16/9] sm:object-right"
        />
      </div>
    </section>
  );
}
