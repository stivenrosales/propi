import { cookies } from "next/headers";
import { site } from "@/content/site";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { GitHubIcon } from "@/components/ui/primitives";
import { sessionSecret } from "@/server/env";
import { readSession, SESSION_COOKIE } from "@/server/session";

const nav = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#self-host", label: "Self-host" },
  { href: "#faq", label: "FAQ" },
];

/** Signature and expiry check only, no database: /app re-checks the member on every request. */
async function hasSession(): Promise<boolean> {
  // Outside the try: cookies() signals dynamic rendering to Next and must not be swallowed.
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return false;
  try {
    return readSession(sessionSecret(), value) !== null;
  } catch {
    return false;
  }
}

export async function SiteHeader() {
  const signedIn = await hasSession();
  const entry = signedIn ? { href: site.appHref, label: "Open app" } : { href: site.signInHref, label: "Sign in" };
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink/10 bg-cream/95 supports-[backdrop-filter]:bg-cream/85 supports-[backdrop-filter]:backdrop-blur-sm">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-cream"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <a href="/" aria-label="Propi home" className="shrink-0">
          <img src="/brand/propi-logo.svg" alt="Propi" width={93} height={36} className="h-9 w-auto" />
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
        <div className="flex shrink-0 items-center gap-2">
          <LocaleSwitcher />
          <a
            href={site.github}
            aria-label="Propi on GitHub"
            className="inline-flex size-9 items-center justify-center rounded-full border-2 border-ink bg-cream transition-colors hover:bg-sunflower sm:size-auto sm:gap-2 sm:px-4 sm:py-1.5"
          >
            <GitHubIcon className="size-4" />
            <span className="hidden text-sm font-semibold sm:inline">GitHub</span>
          </a>
          <a
            href={entry.href}
            className="inline-flex items-center rounded-full border-2 border-ink bg-ink px-4 py-1.5 text-sm font-semibold text-cream shadow-[2px_2px_0_var(--coral)] transition-colors hover:bg-ink-raised"
          >
            {entry.label}
          </a>
        </div>
      </div>
      {/* Small screens: the same sections as a scrollable row under the bar. */}
      <nav aria-label="Sections" className="border-t-2 border-ink/5 md:hidden">
        <ul className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] sm:px-4">
          {nav.map((item) => (
            <li key={item.href} className="shrink-0">
              <a href={item.href} className="block rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-ink/5 hover:text-ink">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
