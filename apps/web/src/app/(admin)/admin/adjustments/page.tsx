import { Gift, MinusCircle, RotateCcw, Undo2 } from "lucide-react";
import { Button, Card, CardTitle, Field, Flash, Input, KeyInput, PageHeader, Select, Textarea } from "@/components/app/ui";
import { adjustmentsPage } from "@/i18n/admin-adjustments.messages";
import { getLocale } from "@/i18n/locale";
import { formatDate, readableText } from "@/lib/format";
import { bonusAction, deductAction, resetAllAction, reverseGiftAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: adjustmentsPage.t(await getLocale())("title") };
}

// S36 bonus, S37 deduction, S38 gift reversal, S39 bulk reset. Every one lands in the audit log (S40).
export default async function Adjustments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const L = await getLocale();
  const t = adjustmentsPage.t(L);
  const [w, recent] = await Promise.all([workspaceView(viewer.ws), propi().boards.feed(viewer.ws, { limit: 40 })]);
  const active = w.members.filter((m) => m.active);
  const options = active.map((m) => (
    <option key={m.id} value={m.id}>{w.label(m.id)}</option>
  ));

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <a href="/admin/audit" className="text-sm font-semibold text-coral-ink hover:underline">{t("audit")}</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle><span className="inline-flex items-center gap-2"><Gift className="size-5 text-mint" /> {t("bonus")}</span></CardTitle>
          <form action={bonusAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label={t("members")} hint={t("membersHint")}>
              <Select name="memberIds" multiple required className="min-h-36">{options}</Select>
            </Field>
            <Field label={t("amountEach")}><Input name="amount" type="number" min={1} required /></Field>
            <Field label={t("reason")}><Input name="reason" required placeholder={t("reasonPlaceholder")} /></Field>
            <Button tone="mint" className="justify-self-start">{t("grant")}</Button>
          </form>
        </Card>
        <Card>
          <CardTitle><span className="inline-flex items-center gap-2"><MinusCircle className="size-5 text-coral" /> {t("deduction")}</span></CardTitle>
          <form action={deductAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label={t("member")}><Select name="memberId" required>{options}</Select></Field>
            <Field label={t("amount")}><Input name="amount" type="number" min={1} required /></Field>
            <Field label={t("reason")} hint={t("required")}><Input name="reason" required /></Field>
            <Button tone="danger" confirm={t("deductConfirm")} className="justify-self-start">{t("deduct")}</Button>
          </form>
        </Card>
        <Card>
          <CardTitle><span className="inline-flex items-center gap-2"><Undo2 className="size-5" /> {t("reverse")}</span></CardTitle>
          <form action={reverseGiftAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label={t("gift")} hint={t("giftHint")}>
              <Select name="giftId" required>
                {recent.map((g) => (
                  <option key={g.giftId} value={g.giftId}>
                    {formatDate(L, g.at, w.settings.timezone)} · {w.label(g.giver)} → {g.receivers.map((r) => w.label(r.memberId)).join(", ")} ({g.units}){g.text ? ` · ${readableText(g.text, w.label).slice(0, 40)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("reason")}><Input name="reason" required /></Field>
            <Button tone="danger" confirm={t("reverseConfirm")} className="justify-self-start">{t("reverseGift")}</Button>
          </form>
        </Card>
        <Card className="border-coral">
          <CardTitle><span className="inline-flex items-center gap-2"><RotateCcw className="size-5 text-coral" /> {t("reset")}</span></CardTitle>
          <p className="mb-3 text-sm text-ink-soft">{t("resetBody")}</p>
          <form action={resetAllAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label={t("reason")}><Textarea name="reason" required rows={2} /></Field>
            <Field label={t("resetType")}><Input name="confirm" required pattern="RESET" autoComplete="off" /></Field>
            <Button tone="danger" confirm={t("resetConfirm")} className="justify-self-start">{t("resetAll")}</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
