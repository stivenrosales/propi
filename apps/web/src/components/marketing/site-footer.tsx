import { site } from "@/content/site";
import { GitHubIcon } from "@/components/ui/primitives";

export function SiteFooter() {
  return (
    <footer className="bg-ink text-cream">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-10 border-t-2 border-cream/10 px-4 py-14 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-10">
        <div>
          <a href="/" aria-label="Propi home" className="inline-block">
            <img src="/brand/propi-logo-on-dark.svg" alt="Propi" width={114} height={44} className="h-11 w-auto" />
          </a>
          <p className="mt-4 max-w-[34ch] text-cream/70">Open-source peer recognition for teams who say thanks.</p>
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
              Licensed AGPL-3.0
            </a>
          </li>
          <li>
            <a href={site.privacy} className="text-cream/85 underline-offset-4 hover:text-sunflower hover:underline">
              Privacy
            </a>
          </li>
          <li>
            <a href={site.terms} className="text-cream/85 underline-offset-4 hover:text-sunflower hover:underline">
              Terms
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
