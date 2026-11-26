import { site } from "@/content/site";
import { Sparkle } from "@/components/ui/primitives";

const reasons = [
  {
    claim: "Open source, AGPL-3.0",
    detail: "Read every line, change what you need. Improvements to Propi stay open for everyone who runs it.",
  },
  {
    claim: "Hosted or self-hosted",
    detail: "Add it to Slack and we run it for you. Or run one docker compose up on your own server, next to your own Postgres.",
  },
  {
    claim: "Your data stays yours",
    detail: "Export gifts, ledger, redemptions and members as CSV at any time, with no date cap. Uninstalling never deletes data without a separate, explicit confirmation.",
  },
  {
    claim: "Fair, simple pricing",
    detail: `Free up to ${site.pricing.freeActiveMembers} active members. After that, $2 per active member per month, and deactivated members never count.`,
  },
];

export function WhyPropi() {
  return (
    <section aria-labelledby="why-title" className="relative overflow-hidden bg-coral py-24 text-ink sm:py-32">
      <Sparkle className="twinkle pointer-events-none absolute -top-16 -right-16 size-40 text-sunflower sm:-top-10 sm:-right-10 sm:size-72" />
      <div className="relative mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h2
              id="why-title"
              className="font-display text-[clamp(2.4rem,1.5rem+3.6vw,4.5rem)] leading-[0.95] font-black tracking-[-0.035em] text-balance"
            >
              Recognition you own, not rent.
            </h2>
            <p className="mt-6 max-w-[40ch] text-lg leading-relaxed font-medium">
              Closed tools charge per person and keep your team&rsquo;s history on their servers. Propi is built the other
              way around.
            </p>
          </div>

          <dl className="divide-y-2 divide-ink border-y-2 border-ink lg:col-span-7">
            {reasons.map((r, i) => (
              <div key={r.claim} className="reveal grid gap-2 py-7 sm:grid-cols-[3.5rem_1fr] sm:gap-6">
                <span aria-hidden="true" className="font-display text-3xl leading-none font-black text-cream [-webkit-text-stroke:2px_var(--ink)]">
                  0{i + 1}
                </span>
                <div>
                  <dt className="font-display text-[1.7rem] leading-tight font-black tracking-tight">{r.claim}</dt>
                  <dd className="mt-2 max-w-[52ch] leading-relaxed font-medium">{r.detail}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
