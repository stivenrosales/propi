import { Sticker } from "lucide-react";
import { Badge, Button, Card, CardTitle, Empty, Field, Flash, Input, KeyInput, PageHeader, Select } from "@/components/app/ui";
import type { Locale } from "@propi/core";
import { stickersPage } from "@/i18n/admin-stickers.messages";
import { getLocale } from "@/i18n/locale";
import { defineStickerAction, grantStickerAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: stickersPage.t(await getLocale())("title") };
}

// S73-S76: an optional module. Stickers do not use the allowance; each member has a monthly quota.
export default async function Stickers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const store = propi().engagement.stickers;
  const L = await getLocale();
  const t = stickersPage.t(L);
  const [config, stickers, w] = await Promise.all([store.config(viewer.ws), store.stickers(viewer.ws), workspaceView(viewer.ws)]);
  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <Badge tone={config.enabled ? "mint" : "muted"}>{config.enabled ? t("on") : t("off")}</Badge>
        <a href="/admin/settings" className="text-sm font-semibold text-coral-ink hover:underline">{t("toggle")}</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle>{t("set")}</CardTitle>
          {stickers.length === 0 ? (
            <Empty title={t("empty")} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {stickers.map((s) => (
                <details key={s.id} className="rounded-3xl border border-line p-4">
                  <summary className="flex cursor-pointer items-center gap-3">
                    {s.image ? <img src={s.image} alt="" className="size-12 rounded-xl" /> : <span className="grid size-12 place-items-center rounded-xl bg-sunflower-soft"><Sticker className="size-6" /></span>}
                    <span className="flex-1">
                      <span className="block font-display font-extrabold">{s.name}</span>
                      <span className="text-xs text-ink-soft">{s.receivers === "channel" ? t("channel") : t("people", { count: s.receivers })} × {s.unitsPerReceiver} · {t("perMonth", { count: s.monthlyQuota })}</span>
                    </span>
                    {s.active ? null : <Badge>{t("pausedBadge")}</Badge>}
                  </summary>
                  <StickerForm s={s} locale={L} />
                </details>
              ))}
            </div>
          )}
        </Card>
        <div className="grid content-start gap-5">
          <Card>
            <CardTitle>{t("new")}</CardTitle>
            <StickerForm locale={L} />
          </Card>
          <Card>
            <CardTitle>{t("grant")}</CardTitle>
            <form action={grantStickerAction} className="grid gap-3">
              <KeyInput value={formKey()} />
              <Field label={t("member")}><Select name="memberId">{w.members.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{w.label(m.id)}</option>)}</Select></Field>
              <Field label={t("sticker")}><Select name="stickerId">{stickers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label={t("uses")}><Input name="uses" type="number" min={1} required /></Field>
              <Button tone="cream" className="justify-self-start">{t("grantButton")}</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function StickerForm({ s, locale }: { s?: { id: string; name: string; image: string | null; receivers: number | "channel"; unitsPerReceiver: number; monthlyQuota: number; active: boolean }; locale: Locale }) {
  const t = stickersPage.t(locale);
  return (
    <form action={defineStickerAction} className="fields mt-3 grid gap-3 sm:grid-cols-2">
      <KeyInput value={formKey()} />
      <input type="hidden" name="stickerId" value={s?.id ?? ""} />
      <Field label={t("field.name")}><Input name="name" defaultValue={s?.name} required /></Field>
      <Field label={t("field.image")}><Input name="image" type="url" defaultValue={s?.image ?? ""} /></Field>
      <Field label={t("field.receivers")} hint={t("field.receiversHint")}><Input name="receivers" defaultValue={s?.receivers ?? 1} required /></Field>
      <Field label={t("field.units")}><Input name="unitsPerReceiver" type="number" min={1} defaultValue={s?.unitsPerReceiver ?? 1} required /></Field>
      <Field label={t("field.quota")}><Input name="monthlyQuota" type="number" min={1} defaultValue={s?.monthlyQuota ?? 1} /></Field>
      <Field label={t("field.status")}>
        <Select name="active" defaultValue={s?.active === false ? "false" : "true"}>
          <option value="true">{t("active")}</option>
          <option value="false">{t("paused")}</option>
        </Select>
      </Field>
      <Button size="sm" className="justify-self-start">{s ? t("save") : t("create")}</Button>
    </form>
  );
}
