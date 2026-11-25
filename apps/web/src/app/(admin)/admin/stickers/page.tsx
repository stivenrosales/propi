import { Sticker } from "lucide-react";
import { Badge, Button, Card, CardTitle, Empty, Field, Flash, Input, KeyInput, PageHeader, Select } from "@/components/app/ui";
import { defineStickerAction, grantStickerAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export const metadata = { title: "Stickers" };

// S73-S76: an optional module. Stickers do not use the allowance; each member has a monthly quota.
export default async function Stickers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const store = propi().engagement.stickers;
  const [config, stickers, w] = await Promise.all([store.config(viewer.ws), store.stickers(viewer.ws), workspaceView(viewer.ws)]);
  return (
    <>
      <PageHeader title="Stickers" eyebrow="Admin">
        <Badge tone={config.enabled ? "mint" : "muted"}>{config.enabled ? "Module on" : "Module off"}</Badge>
        <a href="/admin/settings" className="text-sm font-semibold text-coral-ink hover:underline">Turn on or off</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle>Sticker set</CardTitle>
          {stickers.length === 0 ? (
            <Empty title="No stickers yet" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {stickers.map((s) => (
                <details key={s.id} className="rounded-3xl border border-line p-4">
                  <summary className="flex cursor-pointer items-center gap-3">
                    {s.image ? <img src={s.image} alt="" className="size-12 rounded-xl" /> : <span className="grid size-12 place-items-center rounded-xl bg-sunflower-soft"><Sticker className="size-6" /></span>}
                    <span className="flex-1">
                      <span className="block font-display font-extrabold">{s.name}</span>
                      <span className="text-xs text-ink-soft">{s.receivers === "channel" ? "Whole channel" : `${s.receivers} ${s.receivers === 1 ? "person" : "people"}`} × {s.unitsPerReceiver} · {s.monthlyQuota}/month</span>
                    </span>
                    {s.active ? null : <Badge>paused</Badge>}
                  </summary>
                  <StickerForm s={s} />
                </details>
              ))}
            </div>
          )}
        </Card>
        <div className="grid content-start gap-5">
          <Card>
            <CardTitle>New sticker</CardTitle>
            <StickerForm />
          </Card>
          <Card>
            <CardTitle>Grant extra uses</CardTitle>
            <form action={grantStickerAction} className="grid gap-3">
              <KeyInput value={formKey()} />
              <Field label="Member"><Select name="memberId">{w.members.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{w.label(m.id)}</option>)}</Select></Field>
              <Field label="Sticker"><Select name="stickerId">{stickers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Extra uses this month"><Input name="uses" type="number" min={1} required /></Field>
              <Button tone="cream" className="justify-self-start">Grant</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function StickerForm({ s }: { s?: { id: string; name: string; image: string | null; receivers: number | "channel"; unitsPerReceiver: number; monthlyQuota: number; active: boolean } }) {
  return (
    <form action={defineStickerAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <KeyInput value={formKey()} />
      <input type="hidden" name="stickerId" value={s?.id ?? ""} />
      <Field label="Name"><Input name="name" defaultValue={s?.name} required /></Field>
      <Field label="Image URL"><Input name="image" type="url" defaultValue={s?.image ?? ""} /></Field>
      <Field label="Receivers" hint='A number, or "channel"'><Input name="receivers" defaultValue={s?.receivers ?? 1} required /></Field>
      <Field label="Units per receiver"><Input name="unitsPerReceiver" type="number" min={1} defaultValue={s?.unitsPerReceiver ?? 1} required /></Field>
      <Field label="Monthly quota"><Input name="monthlyQuota" type="number" min={1} defaultValue={s?.monthlyQuota ?? 1} /></Field>
      <Field label="Status">
        <Select name="active" defaultValue={s?.active === false ? "false" : "true"}>
          <option value="true">Active</option>
          <option value="false">Paused</option>
        </Select>
      </Field>
      <Button size="sm" className="justify-self-start">{s ? "Save" : "Create"}</Button>
    </form>
  );
}
