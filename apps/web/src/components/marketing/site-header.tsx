import { site } from "@/content/site";
import { GitHubIcon } from "@/components/ui/primitives";

const nav = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#self-host", label: "Self-host" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink/10 bg-cream/95 supports-[backdrop-filter]:bg-cream/85 supports-[backdrop-filter]:backdrop-blur-sm">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-cream"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-10">
        <a href="/" aria-label="Propi home" className="shrink-0">
          <img src="/brand/propi-logo.svg" alt="Propi" width={111} height={36} className="h-9 w-auto" />
        </a>
        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-full px-3.5 py-2 text-[0.95rem] font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a
          href={site.github}
          className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-cream px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-sunflower"
        >
          <GitHubIcon className="size-4" />
          <span>GitHub</span>
        </a>
      </div>
    </header>
  );
}
