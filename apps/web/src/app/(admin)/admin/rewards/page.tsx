import { Archive, PackagePlus, Pencil, Play, Plus } from "lucide-react";
import type { Reward } from "@propi/core";
import { rewardCatalog } from "@propi/app";
import { RewardArt } from "@/components/app/reward-art";
import { StateBadge } from "@/components/app/state-badge";
import { Badge, Button, Card, CardTitle, Checkbox, Empty, Field, Flash, Input, KeyInput, PageHeader, Select, Textarea, Units } from "@/components/app/ui";
import type { Locale } from "@propi/core";
import { rewardsPage } from "@/i18n/admin-rewards.messages";
import { getLocale } from "@/i18n/locale";
import { formatMoney } from "@/lib/format";
import { archiveCollabAction, createCollabAction, createRewardAction, redeemOnBehalfAction, restockAction, setRewardStatusAction, updateRewardAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { collabs, workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: rewardsPage.t(await getLocale())("title") };
}

function RewardFields({ r, currency, locale }: { r?: Reward; currency: string; locale: Locale }) {
  const t = rewardsPage.t(locale);
  return (
    <>
      <Field label={t("field.title")}><Input name="title" defaultValue={r?.title} required /></Field>
      <Field label={t("field.cost")}><Input name="cost" type="number" min={1} defaultValue={r?.cost} required /></Field>
      <Field label={t("field.description")} className="@lg:col-span-2"><Textarea name="description" defaultValue={r?.description} rows={2} /></Field>
      <Field label={t("field.image")}><Input name="image" type="url" defaultValue={r?.image ?? ""} /></Field>
      <Field label={t("field.categories")} hint={t("field.categoriesHint")}><Input name="categories" defaultValue={r?.categories.join(", ")} /></Field>
      <Field label={t("field.internal")} hint={t("field.internalHint")}>
        <Input name="internalCostMinor" type="number" min={0} defaultValue={r?.internalCost?.minor ?? ""} />
      </Field>
      <Field label={t("field.currency")}><Input name="internalCurrency" maxLength={3} defaultValue={r?.internalCost?.currency ?? currency} placeholder="PEN" /></Field>
      <Field label={t("field.instructions")} className="@lg:col-span-2"><Textarea name="instructions" defaultValue={r?.instructions} rows={2} /></Field>
      <Field label={t("field.approval")}>
        <Select name="autoApprove" defaultValue={r?.autoApprove === null || r === undefined ? "" : String(r.autoApprove)}>
          <option value="">{t("approval.default")}</option>
          <option value="true">{t("approval.auto")}</option>
          <option value="false">{t("approval.manual")}</option>
        </Select>
      </Field>
    </>
  );
}

// S44-S47 rewards CRUD, stock and budget; S55 manual redemption; S56/S58 group rewards.
export default async function Rewards({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  const L = await getLocale();
  const t = rewardsPage.t(L);
  const [rewards, w, groups, shopSettings] = await Promise.all([rewardCatalog(p.shop(viewer.ws), viewer.actor), workspaceView(viewer.ws), collabs(viewer.ws), p.shop(viewer.ws).shopSettings()]);
  // New rewards default to the currency of the shop budget; nothing is assumed when there is none.
  const currency = shopSettings.monthlyBudget?.currency ?? "";
  const order = { active: 0, draft: 1, archived: 2 } as const;
  const sorted = [...rewards].sort((a, b) => order[a.status] - order[b.status]);
  const active = sorted.filter((r) => r.status === "active");

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <a href="/admin/settings" className="text-sm font-semibold text-coral-ink hover:underline">{t("settingsLink")}</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid content-start gap-4">
          {sorted.length === 0 ? (
            <Empty title={t("empty")} art="/brand/mascot-thumbs-up.webp">
              {t("emptyBody")}
            </Empty>
          ) : null}
          {sorted.map((r) => (
            <Card key={r.id} className="p-4 md:p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-20 shrink-0"><RewardArt id={r.id} image={r.image} categories={r.categories} title={r.title} className="h-20" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-extrabold">{r.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StateBadge state={r.status} />
                    <Badge>{r.variants.length > 0 ? t("variants", { count: r.variants.length }) : r.stock === null ? t("unlimited") : t("inStock", { count: r.stock })}</Badge>
                    {r.internalCost ? <Badge tone="sunflower">{formatMoney(L, r.internalCost.minor, r.internalCost.currency)}</Badge> : null}
                  </div>
                </div>
                <Units n={r.cost} className="text-lg" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {r.status !== "archived" ? (
                  <form action={setRewardStatusAction}>
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="rewardId" value={r.id} />
                    <input type="hidden" name="status" value={r.status === "draft" ? "active" : "archived"} />
                    <Button size="sm" tone={r.status === "draft" ? "mint" : "danger"} confirm={r.status === "draft" ? undefined : t("archiveConfirm")}>{r.status === "draft" ? <><Play className="size-4" /> {t("activate")}</> : <><Archive className="size-4" /> {t("archive")}</>}</Button>
                  </form>
                ) : null}
                {r.status !== "archived" && (r.stock !== null || r.variants.length > 0) ? (
                  <form action={restockAction} className="flex items-center gap-1.5">
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="rewardId" value={r.id} />
                    {r.variants.length > 0 ? (
                      <Select name="variantId" className="min-h-9 py-1 text-sm" aria-label={t("variant")}>
                        {r.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </Select>
                    ) : null}
                    <Input name="quantity" type="number" min={1} required placeholder={t("qty")} aria-label={t("quantity")} className="min-h-9 w-20 py-1 text-sm" />
                    <Button size="sm" tone="cream"><PackagePlus className="size-4" /> {t("restock")}</Button>
                  </form>
                ) : null}
              </div>
              {r.status !== "archived" ? (
                <details className="mt-3">
                  <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-coral-ink"><Pencil className="size-3.5" /> {t("edit")}</summary>
                  <form action={updateRewardAction} className="fields mt-3 grid gap-3 @lg:grid-cols-2">
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="rewardId" value={r.id} />
                    <RewardFields r={r} currency={currency} locale={L} />
                    <Button size="sm" className="justify-self-start @lg:col-span-2">{t("saveChanges")}</Button>
                  </form>
                </details>
              ) : null}
            </Card>
          ))}
        </div>

        <div className="grid content-start gap-5">
          <Card>
            <CardTitle><span className="inline-flex items-center gap-2"><Plus className="size-5" /> {t("new")}</span></CardTitle>
            <form action={createRewardAction} className="fields grid gap-3 @lg:grid-cols-2">
              <KeyInput value={formKey()} />
              <RewardFields currency={currency} locale={L} />
              <Field label={t("stock")} hint={t("stockHint")}><Input name="stock" type="number" min={0} /></Field>
              <Field label={t("variants.label")} hint={t("variants.hint")} className="@lg:col-span-2"><Textarea name="variants" rows={2} placeholder={"S: 4\nM: 6"} /></Field>
              <Checkbox name="giftCard" label={t("giftCard")} className="@lg:col-span-2" />
              <Button className="justify-self-start @lg:col-span-2">{t("createDraft")}</Button>
            </form>
          </Card>
          <Card>
            <CardTitle>{t("onBehalf")}</CardTitle>
            <form action={redeemOnBehalfAction} className="grid gap-3">
              <KeyInput value={formKey()} />
              <Field label={t("member")}>
                <Select name="memberId">{w.members.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{w.label(m.id)}</option>)}</Select>
              </Field>
              <Field label={t("reward")}>
                <Select name="rewardId">{active.map((r) => <option key={r.id} value={r.id}>{r.title} ({r.cost})</option>)}</Select>
              </Field>
              <Button tone="cream" className="justify-self-start">{t("createRedemption")}</Button>
            </form>
          </Card>
          <Card>
            <CardTitle>{t("groups")}</CardTitle>
            <ul className="mb-4 space-y-2">
              {groups.map(({ collab, progress }) => (
                <li key={collab.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream/60 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-semibold">{collab.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {progress.raised}/{progress.goal} <StateBadge state={collab.phase} />
                    {collab.phase === "open" ? (
                      <form action={archiveCollabAction}>
                        <KeyInput value={formKey()} />
                        <input type="hidden" name="collabId" value={collab.id} />
                        <Button size="sm" tone="danger" confirm={t("refundConfirm")} aria-label={t("archiveRefund")}><Archive className="size-3.5" /></Button>
                      </form>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <form action={createCollabAction} className="fields grid gap-3 @lg:grid-cols-2">
              <KeyInput value={formKey()} />
              <Field label={t("field.title")} className="@lg:col-span-2"><Input name="title" required /></Field>
              <Field label={t("field.description")} className="@lg:col-span-2"><Textarea name="description" rows={2} /></Field>
              <Field label={t("goal")}><Input name="goal" type="number" min={1} required /></Field>
              <Field label={t("deadline")}><Input name="deadline" type="date" /></Field>
              <Checkbox name="autoApprove" label={t("autoFunded")} className="@lg:col-span-2" />
              <Button tone="cream" className="justify-self-start @lg:col-span-2">{t("startGroup")}</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
