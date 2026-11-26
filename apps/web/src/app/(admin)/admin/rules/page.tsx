import type { AwardRule } from "@propi/core/rules";
import { Badge, Button, Card, CardTitle, Empty, Field, Flash, Input, KeyInput, PageHeader, Select, Units } from "@/components/app/ui";
import type { Locale } from "@propi/core";
import { rulesPage } from "@/i18n/admin-rules.messages";
import { getLocale } from "@/i18n/locale";
import { defineRuleAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";

export async function generateMetadata() {
  return { title: rulesPage.t(await getLocale())("title") };
}

type T = ReturnType<typeof rulesPage.t>;

function criterionText(t: T, r: AwardRule, valueName: (id: string) => string): string {
  const c = r.criterion;
  switch (c.kind) {
    case "top_receivers":
      return t("topReceivers", { count: c.n });
    case "top_givers":
      return t("topGivers", { count: c.n });
    case "distinct_receivers":
      return t("distinct", { count: c.k });
    case "giving_streak":
      return t("streak", { count: c.periods });
    case "most_tagged":
      return t("tagged", { value: valueName(c.valueId) });
  }
}

function RuleForm({ r, values, locale }: { r?: AwardRule; values: readonly { id: string; name: string }[]; locale: Locale }) {
  const t = rulesPage.t(locale);
  const c = r?.criterion;
  const n = c === undefined ? 1 : "n" in c ? c.n : "k" in c ? c.k : "periods" in c ? c.periods : 1;
  return (
    <form action={defineRuleAction} className="fields grid gap-3 @lg:grid-cols-2">
      <KeyInput value={formKey()} />
      <input type="hidden" name="ruleId" value={r?.id ?? ""} />
      <Field label={t("field.name")} className="@lg:col-span-2"><Input name="name" defaultValue={r?.name} required /></Field>
      <Field label={t("field.period")}>
        <Select name="period" defaultValue={r?.period ?? "month"}>
          <option value="week">{t("period.week")}</option>
          <option value="month">{t("period.month")}</option>
          <option value="quarter">{t("period.quarter")}</option>
        </Select>
      </Field>
      <Field label={t("field.reward")}><Input name="reward" type="number" min={1} defaultValue={r?.reward} required /></Field>
      <Field label={t("field.criterion")}>
        <Select name="criterion" defaultValue={c?.kind ?? "top_receivers"}>
          <option value="top_receivers">{t("criterion.top_receivers")}</option>
          <option value="top_givers">{t("criterion.top_givers")}</option>
          <option value="distinct_receivers">{t("criterion.distinct_receivers")}</option>
          <option value="giving_streak">{t("criterion.giving_streak")}</option>
          <option value="most_tagged">{t("criterion.most_tagged")}</option>
        </Select>
      </Field>
      <Field label="N / K / P"><Input name="n" type="number" min={1} defaultValue={n} /></Field>
      <Field label={t("field.value")} hint={t("field.valueHint")}>
        <Select name="valueId" defaultValue={c?.kind === "most_tagged" ? c.valueId : ""}>
          <option value="">{t("none")}</option>
          {values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Field>
      <Field label={t("field.ties")}>
        <Select name="ties" defaultValue={r?.ties ?? "all_win"}>
          <option value="all_win">{t("ties.all_win")}</option>
          <option value="skip_tied">{t("ties.skip_tied")}</option>
        </Select>
      </Field>
      <Field label={t("field.announce")} hint={t("field.announceHint")}><Input name="announceChannel" defaultValue={r?.announceChannel ?? ""} /></Field>
      <Field label={t("field.status")}>
        <Select name="active" defaultValue={r?.active === false ? "false" : "true"}>
          <option value="true">{t("active")}</option>
          <option value="false">{t("paused")}</option>
        </Select>
      </Field>
      <Button size="sm" className="justify-self-start">{r ? t("save") : t("create")}</Button>
    </form>
  );
}

// S60-S63: rules are evaluated by the scheduler after each period closes, in the workspace timezone.
export default async function Rules({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  const [rules, values] = await Promise.all([p.engagement.rules.rules(viewer.ws), p.ports.directory.values(viewer.ws)]);
  const valueName = (id: string) => values.find((v) => v.id === id)?.name ?? id;
  const L = await getLocale();
  const t = rulesPage.t(L);
  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          {rules.length === 0 ? <Empty title={t("empty")}>{t("emptyBody")}</Empty> : null}
          {rules.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-extrabold">{r.name}</p>
                  <p className="text-sm text-ink-soft">{t("every", { period: t(`every.${r.period}`) })} · {criterionText(t, r, valueName)} · {r.ties === "all_win" ? t("tiesWin") : t("tiesSkipped")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Units n={r.reward} />
                  <Badge tone={r.active ? "mint" : "muted"}>{r.active ? t("activeBadge") : t("pausedBadge")}</Badge>
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-coral-ink">{t("edit")}</summary>
                <div className="mt-3"><RuleForm r={r} values={values} locale={L} /></div>
              </details>
            </Card>
          ))}
        </div>
        <Card>
          <CardTitle>{t("new")}</CardTitle>
          <RuleForm values={values} locale={L} />
        </Card>
      </div>
    </>
  );
}
