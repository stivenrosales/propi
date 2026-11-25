import { AppShell } from "@/components/app/shell";
import { requireViewer, shellViewer } from "@/server/auth";

export const dynamic = "force-dynamic";

// Admin and review area. Approvers reach the two review queues (S6); every other page asks for admin.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer("approver");
  return <AppShell viewer={await shellViewer(viewer)}>{children}</AppShell>;
}
