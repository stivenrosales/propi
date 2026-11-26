import Image from "next/image";
import { site } from "@/content/site";
import { ButtonLink, Coin, GitHubIcon, SlackIcon, Sparkle } from "@/components/ui/primitives";
import hero from "../../../public/brand/hero.webp";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div className="mx-auto max-w-[1240px] px-4 pt-12 sm:px-6 sm:pt-16 lg:grid lg:min-h-[min(82vh,760px)] lg:grid-cols-[minmax(0,33rem)_minmax(0,1fr)] lg:items-center lg:gap-10 lg:px-10 lg:py-16 xl:grid-cols-[minmax(0,37rem)_minmax(0,1fr)]">
        <div className="max-w-[34rem] lg:max-w-[33rem] xl:max-w-[37rem]">
          <p className="rise inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-1.5 text-[0.8rem] font-semibold tracking-wide text-cream" style={{ "--i": 0 } as React.CSSProperties}>
            <Sparkle className="twinkle size-3.5 text-sunflower" />
            Open source peer recognition for Slack
          </p>

          <h1
            id="hero-title"
            className="rise mt-6 font-display text-[clamp(2.9rem,1rem+4.6vw,4.6rem)] leading-[0.92] font-black tracking-[-0.035em] text-balance"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            <span className="block">Say thanks.</span>
            <span className="relative inline-block whitespace-nowrap">
              Make it{" "}
              <span className="relative inline-block">
                count.
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
            Propi turns a quick emoji in Slack into props your teammates can see, keep and spend. Add it to Slack in
            a minute, free for teams up to {site.pricing.freeActiveMembers}, or run it on your own servers.
          </p>

          <p
            className="rise mt-5 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border-2 border-ink bg-mint-soft px-3.5 py-2 text-[0.95rem] font-semibold"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            <span className="size-2 shrink-0 rounded-full bg-mint ring-2 ring-ink" aria-hidden="true" />
            <span>Hosted on {site.hostedDomain}</span>
            <span aria-hidden="true" className="hidden text-ink-soft sm:inline">·</span>
            <span className="basis-full pl-4 sm:basis-auto sm:pl-0">free up to {site.pricing.freeActiveMembers} active members</span>
          </p>

          <div className="rise mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap" style={{ "--i": 3 } as React.CSSProperties}>
            <ButtonLink href={site.installHref} tone="coral">
              <SlackIcon className="size-5" />
              Add to Slack
            </ButtonLink>
            <ButtonLink href={site.signInHref} tone="cream">
              Sign in
            </ButtonLink>
          </div>
          <p className="rise mt-4 text-[0.95rem] text-ink-muted" style={{ "--i": 3 } as React.CSSProperties}>
            Prefer your own servers?{" "}
            <a href="#self-host" className="inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-coral decoration-2 underline-offset-4 hover:decoration-ink">
              <GitHubIcon className="size-4" />
              Self-host it free
            </a>
          </p>

          {/* A real-looking gift message, built from the spec's own example shape. */}
          <figure
            className="rise mt-10 max-w-[25rem] rounded-2xl border-2 border-ink bg-cream p-4 shadow-sticker"
            style={{ "--i": 4 } as React.CSSProperties}
          >
            <figcaption className="sr-only">Example: giving props in a Slack channel</figcaption>
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-mint font-display text-sm font-black">
                J
              </span>
              <div className="min-w-0 text-[0.95rem] leading-snug">
                <p className="font-semibold">
                  Jo <span className="ml-1 text-xs font-normal text-ink-soft">#team-ops</span>
                </p>
                <p className="mt-0.5">
                  <span className="rounded bg-coral-soft px-1 font-medium">@lin</span> thanks for untangling the
                  deploy{" "}
                  <span className="whitespace-nowrap">
                    <Coin /> <Coin /> <Coin />
                  </span>
                </p>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-2 border-t-2 border-dashed border-line pt-3 text-sm text-ink-soft">
              <span className="size-2 rounded-full bg-mint" aria-hidden="true" />
              Only visible to you: 3 props sent to Lin. You have 2 left today.
            </p>
          </figure>
        </div>

        {/* Illustration: right column on wide screens, centred on the copy. The source has an empty
            left third, so it is cropped to the people and its edges fade into the page. */}
        <div className="hero-art pointer-events-none hidden lg:-mr-10 lg:block xl:-mr-16">
          <Image
            src={hero}
            alt="Four teammates tossing glowing coral coins to each other between chat bubbles"
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="aspect-[5/4] w-full object-cover object-right [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent_0%,black_10%),linear-gradient(to_bottom,black_80%,transparent_100%)]"
          />
        </div>
      </div>

      {/* Mobile and tablet illustration */}
      <div className="relative mt-10 lg:hidden">
        <Image
          src={hero}
          alt="Four teammates tossing glowing coral coins to each other between chat bubbles"
          sizes="100vw"
          className="aspect-[4/3] w-full object-cover object-[78%_center] sm:aspect-[16/9] sm:object-right"
        />
      </div>
    </section>
  );
}
