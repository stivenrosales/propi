import { Download } from "lucide-react";
import { Card, PageHeader } from "@/components/app/ui";
import { exportPage } from "@/i18n/admin-export.messages";
import { getLocale } from "@/i18n/locale";
import { requireViewer } from "@/server/auth";

export async function generateMetadata() {
  return { title: exportPage.t(await getLocale())("title") };
}

const TABLES = ["gifts", "ledger", "redemptions", "members"] as const;

// S71: export everything as CSV, any time, with no date-range cap.
export default async function Export() {
  await requireViewer("admin");
  const t = exportPage.t(await getLocale());
  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
      <div className="grid gap-4 sm:grid-cols-2">
        {TABLES.map((id) => (
          <Card key={id} className="flex items-center gap-4">
            <div className="flex-1">
              <p className="font-display text-lg font-extrabold">{t(`${id}.title`)}</p>
              <p className="text-sm text-ink-soft">{t(`${id}.text`)}</p>
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
