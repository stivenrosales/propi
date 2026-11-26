import { site } from "@/content/site";
import { getLocale } from "@/i18n/locale";
import { landing } from "@/i18n/landing.messages";

// The answers' plan facts come from site.pricing, matching pricing, why-propi and the terms page.
const faqs = ["cost", "tacos", "allowance", "heytaco", "rewards", "teams"] as const;
const facts = { free: site.pricing.freeActiveMembers, price: site.pricing.proPerActiveMemberUsd };

export async function Faq() {
  const t = landing.t(await getLocale());
  return (
    <section id="faq" aria-labelledby="faq-title" className="py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-10">
        <h2
          id="faq-title"
          className="font-display text-[clamp(2.25rem,1.5rem+3vw,3.75rem)] leading-[0.98] font-black tracking-[-0.03em] text-balance lg:col-span-4"
        >
          {t("faq.title")}
        </h2>
        <div className="divide-y-2 divide-ink border-y-2 border-ink lg:col-span-8">
          {faqs.map((id) => (
            <details key={id} className="group">
              <summary className="flex cursor-pointer items-center justify-between gap-6 py-6 font-display text-xl font-extrabold tracking-tight sm:text-[1.4rem]">
                {t(`faq.${id}.q`)}
                <span
                  aria-hidden="true"
                  className="faq-plus grid size-9 shrink-0 place-items-center rounded-full border-2 border-ink bg-sunflower text-xl leading-none font-black group-open:bg-coral"
                >
                  +
                </span>
              </summary>
              <p className="max-w-[62ch] pb-7 text-[1.05rem] leading-relaxed text-ink-muted">{id === "cost" ? t("faq.cost.a", facts) : t(`faq.${id}.a`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
