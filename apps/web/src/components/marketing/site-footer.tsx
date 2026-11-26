import { site } from "@/content/site";
import { GitHubIcon } from "@/components/ui/primitives";
import { getLocale } from "@/i18n/locale";
import { landing } from "@/i18n/landing.messages";

export async function SiteFooter() {
  const t = landing.t(await getLocale());
  return (
    <footer className="bg-ink text-cream">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-10 border-t-2 border-cream/10 px-4 py-14 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-10">
        <div>
          <a href="/" aria-label={t("nav.home")} className="inline-block">
            <img src="/brand/propi-logo-on-dark.svg" alt="Propi" width={114} height={44} className="h-11 w-auto" />
          </a>
          <p className="mt-4 max-w-[34ch] text-cream/70">{t("footer.tagline")}</p>
        </div>
        <ul className="flex flex-col gap-3 text-sm font-medium sm:flex-row sm:items-center sm:gap-6">
          <li>
            <a href={site.github} className="inline-flex items-center gap-2 text-cream/85 underline-offset-4 hover:text-sunflower hover:underline">
              <GitHubIcon className="size-4" />
              stivenrosales/propi
            </a>
          </li>
          <li>
            <a href={site.license} className="text-cream/85 underline-offset-4 hover:text-sunflower hover:underline">
              {t("footer.license")}
            </a>
          </li>
          <li>
            <a href={site.privacy} className="text-cream/85 underline-offset-4 hover:text-sunflower hover:underline">
              {t("footer.privacy")}
            </a>
          </li>
          <li>
            <a href={site.terms} className="text-cream/85 underline-offset-4 hover:text-sunflower hover:underline">
              {t("footer.terms")}
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
