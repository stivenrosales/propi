import { site } from "@/content/site";
import { ButtonLink, SlackIcon, Sparkle } from "@/components/ui/primitives";
import { getLocale } from "@/i18n/locale";
import { landing } from "@/i18n/landing.messages";

function plans(t: ReturnType<typeof landing.t>) {
  const free = site.pricing.freeActiveMembers;
  return [
    {
      name: t("pricing.free.name"),
      price: "$0",
      unit: t("pricing.free.unit"),
      summary: t("pricing.free.summary", { free }),
      points: [t("pricing.free.point1", { free }), t("pricing.free.point2"), t("pricing.free.point3")],
      tone: "bg-cream",
      cta: "cream" as const,
    },
    {
      name: t("pricing.pro.name"),
      price: `$${site.pricing.proPerActiveMemberUsd}`,
      unit: t("pricing.pro.unit"),
      summary: t("pricing.pro.summary"),
      points: [t("pricing.pro.point1"), t("pricing.pro.point2", { billedBy: site.pricing.billedBy }), t("pricing.pro.point3")],
      tone: "bg-sunflower",
      cta: "coral" as const,
    },
  ];
}

/** S3: the hosted plans, from the same facts as the FAQ, why-propi and the terms page. */
export async function Pricing() {
  const t = landing.t(await getLocale());
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
        <div className="max-w-[40rem]">
          <p className="inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-1.5 text-[0.8rem] font-semibold tracking-wide text-cream">
            <Sparkle className="size-3.5 text-sunflower" />
            {t("pricing.hosted", { domain: site.hostedDomain })}
          </p>
          <h2
            id="pricing-title"
            className="mt-5 font-display text-[clamp(2.25rem,1.5rem+3vw,3.75rem)] leading-[0.98] font-black tracking-[-0.03em] text-balance"
          >
            {t("pricing.title")}
          </h2>
          <p className="mt-5 max-w-[48ch] text-lg leading-relaxed text-ink-muted">
            {t("pricing.lead", { free: site.pricing.freeActiveMembers })}
          </p>
        </div>

        <ul className="mt-12 grid gap-6 md:grid-cols-2">
          {plans(t).map((plan) => (
            <li key={plan.name} className={`reveal flex flex-col rounded-[1.75rem] border-2 border-ink p-7 shadow-chunky sm:p-9 ${plan.tone}`}>
              <h3 className="font-display text-2xl font-black tracking-tight">{plan.name}</h3>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-[3.5rem] leading-none font-black tracking-[-0.04em]">{plan.price}</span>
                <span className="font-semibold text-ink-muted">{plan.unit}</span>
              </p>
              <p className="mt-4 leading-relaxed font-medium">{plan.summary}</p>
              <ul className="mt-6 grid gap-3 border-t-2 border-dashed border-ink/25 pt-6">
                {plan.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 font-medium">
                    <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-mint text-xs font-black">
                      ✓
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-8">
                <ButtonLink href={site.installHref} tone={plan.cta} className="w-full sm:w-auto">
                  <SlackIcon className="size-5" />
                  {t("pricing.addToSlack")}
                </ButtonLink>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-lg font-medium">
          {t("pricing.selfHostPrompt")}{" "}
          <a href="#self-host" className="font-bold underline decoration-coral decoration-[3px] underline-offset-4 hover:decoration-ink">
            {t("pricing.selfHostLink")}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
