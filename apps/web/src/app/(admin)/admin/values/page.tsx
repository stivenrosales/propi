import { Button, Card, Flash, Input, PageHeader } from "@/components/app/ui";
import { getLocale } from "@/i18n/locale";
import { valuesPage } from "@/i18n/admin-values.messages";
import { saveValuesAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";

export async function generateMetadata() {
  return { title: valuesPage.t(await getLocale())("title") };
}

// S41: the workspace values, each with a name, an optional hashtag and an optional emoji.
export default async function Values({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const values = await propi().ports.directory.values(viewer.ws);
  const t = valuesPage.t(await getLocale());
  const rows = [...values, { id: "", name: "", hashtag: null, emoji: null }, { id: "", name: "", hashtag: null, emoji: null }];
  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="max-w-3xl">
        <p className="mb-4 text-sm text-ink-soft">{t("intro")}</p>
        <form action={saveValuesAction} className="grid gap-3">
          <div className="hidden grid-cols-3 gap-3 text-xs font-bold tracking-wide text-ink-soft uppercase sm:grid">
            <span>{t("name")}</span>
            <span>{t("hashtag")}</span>
            <span>{t("emoji")}</span>
          </div>
          {rows.map((v, i) => (
            <div key={v.id || `new-${i}`} className="grid gap-2 rounded-2xl bg-cream/50 p-2 sm:grid-cols-3 sm:bg-transparent sm:p-0">
              <input type="hidden" name="id" value={v.id} />
              <Input name="name" defaultValue={v.name} placeholder={v.id ? "" : t("newValue")} aria-label={t("name")} />
              <Input name="hashtag" defaultValue={v.hashtag ?? ""} placeholder={v.id ? "" : "#hashtag"} aria-label={t("hashtag")} />
              <Input name="emoji" defaultValue={v.emoji ?? ""} placeholder={v.id ? "" : ":emoji:"} aria-label={t("emoji")} />
            </div>
          ))}
          <Button className="justify-self-start">{t("save")}</Button>
        </form>
      </Card>
    </>
  );
}
