import type { ReactNode } from "react";
import { formatDate } from "@propi/core/i18n";
import { Eyebrow } from "@/components/ui/primitives";
import { getLocale } from "@/i18n/locale";
import { legal } from "@/i18n/legal.messages";
import { rich } from "./rich-text";

/** Shared frame for /privacy and /terms: a readable column with the marketing type scale. */
export async function LegalPage({
  title,
  effective,
  intro,
  children,
}: {
  title: string;
  /** YYYY-MM-DD */
  effective: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  const locale = await getLocale();
  const t = legal.t(locale);
  const date = formatDate(locale, new Date(`${effective}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" });
  return (
    <article className="mx-auto max-w-[760px] px-4 pt-32 pb-24 sm:px-6 sm:pt-40">
      <Eyebrow className="text-coral-ink">{t("eyebrow")}</Eyebrow>
      <h1 className="mt-5 font-display text-[clamp(2.25rem,1.5rem+3vw,3.5rem)] leading-[1.02] font-black tracking-[-0.03em] text-balance">
        {title}
      </h1>
      <p className="mt-4 text-sm font-semibold text-ink-soft">
        {rich(t("effective", { date: "{date}" }), { date: <time dateTime={effective}>{date}</time> })}
      </p>
      <div className="mt-8 text-lg leading-[1.7] text-ink-soft">{intro}</div>
      <div className="mt-12 flex flex-col gap-10">{children}</div>
    </article>
  );
}

/** One numbered section of a legal page. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t-2 border-ink/10 pt-8">
      <h2 id={id} className="font-display text-2xl font-black tracking-tight">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4 leading-[1.7] text-ink-soft [&_a]:font-bold [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        {children}
      </div>
    </section>
  );
}
