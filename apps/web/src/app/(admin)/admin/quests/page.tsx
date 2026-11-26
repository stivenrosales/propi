import type { Quest } from "@propi/core/quests";
import { StateBadge } from "@/components/app/state-badge";
import { Badge, Button, Card, CardTitle, Checkbox, Empty, Field, Flash, Input, KeyInput, PageHeader, Select, Textarea, Units } from "@/components/app/ui";
import type { Locale } from "@propi/core";
import { adminQuestsPage } from "@/i18n/admin-quests.messages";
import { getLocale } from "@/i18n/locale";
import { defineQuestAction, questStateAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";

export async function generateMetadata() {
  return { title: adminQuestsPage.t(await getLocale())("title") };
}

const day = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 10));

function QuestForm({ q, locale }: { q?: Quest; locale: Locale }) {
  const t = adminQuestsPage.t(locale);
  return (
    <form action={defineQuestAction} className="fields grid gap-3 @lg:grid-cols-2">
      <KeyInput value={formKey()} />
      <input type="hidden" name="questId" value={q?.id ?? ""} />
      <Field label={t("field.title")} className="@lg:col-span-2"><Input name="title" defaultValue={q?.title} required /></Field>
      <Field label={t("field.description")} className="@lg:col-span-2"><Textarea name="description" defaultValue={q?.description} rows={2} /></Field>
      <Field label={t("field.image")} className="@lg:col-span-2"><Input name="image" type="url" defaultValue={q?.image ?? ""} /></Field>
      <Field label={t("field.reward")}>
        <Select name="rewardMode" defaultValue={q?.reward.mode ?? "fixed"}>
          <option value="fixed">{t("reward.fixed")}</option>
          <option value="approver_choice">{t("reward.approver_choice")}</option>
          <option value="recognition">{t("reward.recognition")}</option>
        </Select>
      </Field>
      <Field label={t("field.amount")} hint={t("field.amountHint")}><Input name="rewardAmount" type="number" min={1} defaultValue={q?.reward.mode === "fixed" ? q.reward.amount : ""} /></Field>
      <Field label={t("field.submitters")}>
        <Select name="submitters" defaultValue={q?.submitters ?? "both"}>
          <option value="self">{t("submitters.self")}</option>
          <option value="nomination">{t("submitters.nomination")}</option>
          <option value="both">{t("submitters.both")}</option>
        </Select>
      </Field>
      <Field label={t("field.cooldown")}><Input name="cooldownHours" type="number" min={0} defaultValue={q ? q.cooldownMs / 3_600_000 : 0} /></Field>
      <Field label={t("field.perPerson")} hint={t("emptyNone")}><Input name="perSubmitterCap" type="number" min={1} defaultValue={q?.perSubmitterCap ?? ""} /></Field>
      <Field label={t("field.team")} hint={t("emptyNone")}><Input name="teamCap" type="number" min={1} defaultValue={q?.teamCap ?? ""} /></Field>
      <Field label={t("field.opens")}><Input name="opensAt" type="date" defaultValue={day(q?.opensAt ?? null)} /></Field>
      <Field label={t("field.closes")}><Input name="closesAt" type="date" defaultValue={day(q?.closesAt ?? null)} /></Field>
      <fieldset className="grid gap-2 @lg:col-span-2">
        <Checkbox name="proofRequired" label={t("proof")} defaultChecked={q?.proofRequired ?? false} />
        <Checkbox name="approvalRequired" label={t("approval")} defaultChecked={q?.approvalRequired ?? true} />
        <Checkbox name="timeline" label={t("timeline")} defaultChecked={q?.timeline ?? true} />
      </fieldset>
      <Button size="sm" className="justify-self-start">{q ? t("save") : t("create")}</Button>
    </form>
  );
}

// S64-S65: define quests and move them draft → open → closed.
export default async function AdminQuests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const quests = await propi().engagement.quests.quests(viewer.ws);
  const L = await getLocale();
  const t = adminQuestsPage.t(L);
  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <a href="/admin/submissions" className="text-sm font-semibold text-coral-ink hover:underline">{t("review")}</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          {quests.length === 0 ? <Empty title={t("empty")}>{t("emptyBody")}</Empty> : null}
          {quests.map((q) => (
            <Card key={q.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-extrabold">{q.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <StateBadge state={q.state} />
                    {q.reward.mode === "fixed" ? <Badge tone="coral"><Units n={q.reward.amount} className="text-xs" /></Badge> : <Badge tone="sunflower">{t(`reward.${q.reward.mode}`)}</Badge>}
                    <Badge>{t(`submitters.${q.submitters}`)}</Badge>
                  </div>
                </div>
                {q.state !== "closed" ? (
                  <form action={questStateAction}>
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="questId" value={q.id} />
                    <input type="hidden" name="to" value={q.state === "draft" ? "open" : "closed"} />
                    <Button size="sm" tone={q.state === "draft" ? "mint" : "cream"}>{q.state === "draft" ? t("publish") : t("close")}</Button>
                  </form>
                ) : null}
              </div>
              {q.state === "draft" ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-coral-ink">{t("edit")}</summary>
                  <div className="mt-3"><QuestForm q={q} locale={L} /></div>
                </details>
              ) : null}
            </Card>
          ))}
        </div>
        <Card>
          <CardTitle>{t("new")}</CardTitle>
          <QuestForm locale={L} />
        </Card>
      </div>
    </>
  );
}
