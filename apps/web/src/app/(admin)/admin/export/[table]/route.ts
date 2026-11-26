// S71: one table of the full export as a CSV download. Admins only (core canExport).
import { NextResponse } from "next/server";
import { exportPage } from "@/i18n/admin-export.messages";
import { getLocale } from "@/i18n/locale";
import { currentViewer } from "@/server/auth";
import { propi } from "@/server/propi";

export const dynamic = "force-dynamic";

const TABLES = ["gifts", "ledger", "redemptions", "members"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const t = exportPage.t(await getLocale());
  if (!(TABLES as readonly string[]).includes(table)) return new NextResponse(t("notFound"), { status: 404 });
  const viewer = await currentViewer();
  if (viewer === null || !viewer.active) return new NextResponse(t("signIn"), { status: 401 });
  const res = await propi().privacy.exportAll(viewer.ws, viewer.actor);
  if (!res.ok) return new NextResponse(t("adminsOnly"), { status: 403 });
  const csv = res.value.csv[table as (typeof TABLES)[number]];
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="propi-${table}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
