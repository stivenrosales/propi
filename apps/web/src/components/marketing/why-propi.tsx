import { site } from "@/content/site";
import { Sparkle } from "@/components/ui/primitives";
import { getLocale } from "@/i18n/locale";
import { landing } from "@/i18n/landing.messages";

function reasons(t: ReturnType<typeof landing.t>) {
  return [
    { claim: t("why.open.claim"), detail: t("why.open.detail") },
    { claim: t("why.hosting.claim"), detail: t("why.hosting.detail") },
    { claim: t("why.data.claim"), detail: t("why.data.detail") },
    {
      claim: t("why.pricing.claim"),
      detail: t("why.pricing.detail", { free: site.pricing.freeActiveMembers, price: site.pricing.proPerActiveMemberUsd }),
    },
  ];
}

export async function WhyPropi() {
  const t = landing.t(await getLocale());
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
              {t("why.title")}
            </h2>
            <p className="mt-6 max-w-[40ch] text-lg leading-relaxed font-medium">
              {t("why.lead")}
            </p>
          </div>

          <dl className="divide-y-2 divide-ink border-y-2 border-ink lg:col-span-7">
            {reasons(t).map((r, i) => (
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
