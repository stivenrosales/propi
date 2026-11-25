// S71: one table of the full export as a CSV download. Admins only (core canExport).
import { NextResponse } from "next/server";
import { currentViewer } from "@/server/auth";
import { propi } from "@/server/propi";

export const dynamic = "force-dynamic";

const TABLES = ["gifts", "ledger", "redemptions", "members"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!(TABLES as readonly string[]).includes(table)) return new NextResponse("Not found", { status: 404 });
  const viewer = await currentViewer();
  if (viewer === null || !viewer.active) return new NextResponse("Sign in first", { status: 401 });
  const res = await propi().privacy.exportAll(viewer.ws, viewer.actor);
  if (!res.ok) return new NextResponse("Admins only", { status: 403 });
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
