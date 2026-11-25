import { Download } from "lucide-react";
import { Card, PageHeader } from "@/components/app/ui";
import { requireViewer } from "@/server/auth";

export const metadata = { title: "Export" };

const TABLES = [
  ["gifts", "Gifts", "Every gift header: giver, channel, text and value tags."],
  ["ledger", "Ledger", "Every ledger entry in commit order."],
  ["redemptions", "Redemptions", "Every redemption and its state."],
  ["members", "Members", "Every member, role and status."],
] as const;

// S71: export everything as CSV, any time, with no date-range cap.
export default async function Export() {
  await requireViewer("admin");
  return (
    <>
      <PageHeader title="Export" eyebrow="Admin" />
      <div className="grid gap-4 sm:grid-cols-2">
        {TABLES.map(([id, title, text]) => (
          <Card key={id} className="flex items-center gap-4">
            <div className="flex-1">
              <p className="font-display text-lg font-extrabold">{title}</p>
              <p className="text-sm text-ink-soft">{text}</p>
            </div>
            <a href={`/admin/export/${id}`} download className="lift inline-flex min-h-10 items-center gap-2 rounded-full border-2 border-ink bg-coral px-4 font-display text-sm font-extrabold shadow-sticker">
              <Download className="size-4" /> CSV
            </a>
          </Card>
        ))}
      </div>
    </>
  );
}
