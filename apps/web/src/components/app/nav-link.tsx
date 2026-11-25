"use client";
// Navigation link that knows when it is the current page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children, exact = false }: { href: string; children: ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-[0.95rem] font-semibold transition-colors ${
        active ? "bg-coral text-ink shadow-[0_2px_0_0_var(--cream)]" : "text-cream/80 hover:bg-ink-raised hover:text-cream"
      }`}
    >
      {children}
    </Link>
  );
}
