// The signed-in app frame: an ink sidebar on desktop, a scrolling tab bar on phones.
import type { ReactNode } from "react";
import {
  BadgeCheck,
  Gift,
  Home,
  KeyRound,
  LineChart,
  LogOut,
  Medal,
  ScrollText,
  Settings,
  ShoppingBag,
  Sparkles,
  Sticker,
  Tags,
  Target,
  Trophy,
  User,
  Users,
  Wallet,
  Wand2,
  Handshake,
  Inbox,
  Download,
} from "lucide-react";
import type { Role } from "@propi/core";
import { allows } from "@/server/roles";
import { Avatar } from "./ui";
import { NavLink } from "./nav-link";

const icon = "size-[1.1rem] shrink-0";

const MEMBER_NAV = [
  { href: "/app", label: "Home", icon: <Home className={icon} />, exact: true },
  { href: "/app/shop", label: "Shop", icon: <ShoppingBag className={icon} /> },
  { href: "/app/redemptions", label: "My redemptions", icon: <Gift className={icon} /> },
  { href: "/app/collabs", label: "Group rewards", icon: <Handshake className={icon} /> },
  { href: "/app/quests", label: "Quests", icon: <Target className={icon} /> },
  { href: "/app/leaderboards", label: "Leaderboards", icon: <Trophy className={icon} /> },
  { href: "/app/profile", label: "Profile", icon: <User className={icon} /> },
];

const REVIEW_NAV = [
  { href: "/admin/redemptions", label: "Redemption queue", icon: <Inbox className={icon} /> },
  { href: "/admin/submissions", label: "Submission review", icon: <BadgeCheck className={icon} /> },
];

const ADMIN_NAV = [
  { href: "/admin", label: "Insights", icon: <LineChart className={icon} />, exact: true },
  { href: "/admin/settings", label: "Settings", icon: <Settings className={icon} /> },
  { href: "/admin/members", label: "Members", icon: <Users className={icon} /> },
  { href: "/admin/adjustments", label: "Adjustments", icon: <Wallet className={icon} /> },
  { href: "/admin/audit", label: "Audit log", icon: <ScrollText className={icon} /> },
  { href: "/admin/values", label: "Values", icon: <Tags className={icon} /> },
  { href: "/admin/rewards", label: "Rewards", icon: <Sparkles className={icon} /> },
  { href: "/admin/rules", label: "Award rules", icon: <Medal className={icon} /> },
  { href: "/admin/quests", label: "Quests", icon: <Wand2 className={icon} /> },
  { href: "/admin/stickers", label: "Stickers", icon: <Sticker className={icon} /> },
  { href: "/admin/api", label: "API & webhooks", icon: <KeyRound className={icon} /> },
  { href: "/admin/export", label: "Export", icon: <Download className={icon} /> },
];

function Group({ title, items }: { title: string; items: { href: string; label: string; icon: ReactNode; exact?: boolean }[] }) {
  return (
    <div className="flex shrink-0 gap-1 lg:flex-col">
      <p className="hidden px-3 pt-3 pb-1 text-[0.7rem] font-bold tracking-[0.14em] text-cream/65 uppercase lg:block">{title}</p>
      {items.map((i) => (
        <NavLink key={i.href} href={i.href} exact={i.exact ?? false}>
          {i.icon}
          <span>{i.label}</span>
        </NavLink>
      ))}
    </div>
  );
}

export function AppShell({ viewer, children }: { viewer: { memberId: string; role: Role; label: string; picture: string | null }; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="sticky top-0 z-30 bg-ink text-cream">
        <div className="lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 lg:px-5 lg:pt-6">
          <a href="/app" className="shrink-0" aria-label="Propi home">
            <img src="/brand/propi-logo-on-dark.svg" alt="Propi" className="h-8 w-auto lg:h-9" />
          </a>
          <a href="/auth/logout" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-cream/75 hover:bg-ink-raised hover:text-cream lg:hidden">
            <LogOut className="size-4" /> Sign out
          </a>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-2rem),transparent)] lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)] lg:px-3 lg:pb-4">
          <Group title="Me" items={MEMBER_NAV} />
          {allows(viewer.role, "approver") ? <Group title="Review" items={REVIEW_NAV} /> : null}
          {allows(viewer.role, "admin") ? <Group title="Admin" items={ADMIN_NAV} /> : null}
        </nav>
        <div className="mx-3 mt-2 mb-4 hidden shrink-0 items-center gap-3 rounded-2xl bg-ink-raised p-3 lg:flex">
          <Avatar id={viewer.memberId} label={viewer.label} src={viewer.picture} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{viewer.label}</p>
            <p className="text-xs text-cream/60 capitalize">{viewer.role}</p>
          </div>
          <a href="/auth/logout" aria-label="Sign out" className="grid size-11 place-items-center rounded-full text-cream/70 hover:bg-ink hover:text-cream">
            <LogOut className="size-4" />
          </a>
        </div>
        </div>
      </aside>
      <main id="main" className="relative min-w-0 px-4 py-6 md:px-8 md:py-10 lg:px-12">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
