import { AppShell } from "@/components/app/shell";
import { shell } from "@/i18n/app-shell.messages";
import { getLocale } from "@/i18n/locale";
import { requireViewer, shellViewer } from "@/server/auth";
import { overPlanLimit } from "@/server/billing";

export const dynamic = "force-dynamic";

// Admin and review area. Approvers reach the two review queues (S6); every other page asks for admin.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer("approver");
  // S7: admins of a Free workspace over its member limit see the upgrade prompt on every admin page.
  const over = viewer.role === "admin" ? await overPlanLimit(viewer.ws) : null;
  const locale = await getLocale();
  const t = shell.t(locale);
  return (
    <AppShell viewer={await shellViewer(viewer)} locale={locale}>
      {over !== null ? (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-sunflower-soft px-4 py-3 text-sm text-ink">
          <span>
            <strong>{t("plan.over")}</strong> {t("plan.overDetail", { active: over.activeMembers, limit: over.limit ?? "" })}
          </span>
          <a href="/admin/billing" className="font-display font-extrabold underline">
            {t("plan.upgrade")}
          </a>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
