// i18n S4a: the ES | EN switcher for the landing header and the sign-in page. A plain form posting a
// server action, so it works without JavaScript; the page re-renders in the chosen language.
import { getLocale } from "@/i18n/locale";
import { LANGUAGE_NAMES, language } from "@/i18n/language.messages";
import { cx } from "@/lib/cx";
import { setLocaleAction } from "@/server/actions/language";

const ORDER = ["es", "en"] as const;

export async function LocaleSwitcher({ className }: { className?: string }) {
  const locale = await getLocale();
  const t = language.t(locale);
  return (
    <form action={setLocaleAction} role="group" aria-label={t("switcher.label")} className={cx("inline-flex items-center rounded-full border-2 border-ink bg-cream p-0.5 text-sm font-semibold", className)}>
      {ORDER.map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          lang={l}
          aria-label={LANGUAGE_NAMES[l]}
          aria-pressed={l === locale}
          className={cx("min-h-8 min-w-9 rounded-full px-2.5 transition-colors", l === locale ? "bg-ink text-cream" : "text-ink-muted hover:bg-ink/5 hover:text-ink")}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
