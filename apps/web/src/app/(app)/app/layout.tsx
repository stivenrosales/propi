import { AppShell } from "@/components/app/shell";
import { requireViewer, shellViewer } from "@/server/auth";

export const dynamic = "force-dynamic";

// Member area (S28, S44-S59, S64-S67, S77-S82, S92). Any active member.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer("member");
  return <AppShell viewer={await shellViewer(viewer)}>{children}</AppShell>;
}
