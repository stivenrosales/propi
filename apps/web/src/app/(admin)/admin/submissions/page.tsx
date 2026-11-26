import { Check, X } from "lucide-react";
import { Avatar, Badge, Button, Card, Empty, Flash, Input, KeyInput, PageHeader, Units } from "@/components/app/ui";
import { submissionsPage } from "@/i18n/admin-submissions.messages";
import { getLocale } from "@/i18n/locale";
import { formatDate } from "@/lib/format";
import { reviewSubmissionAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: submissionsPage.t(await getLocale())("title") };
}

// S66: approvers and admins approve or reject pending quest submissions, even after the quest closed.
export default async function Submissions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("approver");
  const sp = await searchParams;
  const store = propi().engagement.quests;
  const L = await getLocale();
  const t = submissionsPage.t(L);
  const [quests, w] = await Promise.all([store.quests(viewer.ws), workspaceView(viewer.ws)]);
  const pending = (await Promise.all(quests.map(async (q) => (await store.submissions(viewer.ws, q.id)).filter((s) => s.state === "pending").map((s) => ({ q, s }))))).flat();
  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <Badge tone="sunflower">{t("waiting", { count: pending.length })}</Badge>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      {pending.length === 0 ? (
        <Empty title={t("empty")} art="/brand/mascot-thumbs-up.webp" />
      ) : (
        <div className="grid gap-4">
          {pending.map(({ q, s }) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-start gap-4">
                <Avatar id={s.memberId} label={w.label(s.memberId)} src={w.avatar(s.memberId)} />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-extrabold">{w.label(s.memberId)} · {q.title}</p>
                  <p className="text-sm text-ink-soft">
                    {s.submittedBy && s.submittedBy !== s.memberId ? t("nominatedBy", { name: w.label(s.submittedBy) }) : ""}
                    {formatDate(L, s.submittedAt, w.settings.timezone, true)}
                  </p>
                  {s.proof ? <p className="mt-2 text-sm break-all"><span className="font-semibold">{t("proof")}</span> {/^https?:\/\//.test(s.proof) ? <a href={s.proof} target="_blank" rel="noreferrer noopener" className="text-coral-ink underline">{s.proof}</a> : s.proof}</p> : null}
                  {s.note ? <p className="mt-1 text-sm">{s.note}</p> : null}
                </div>
                {q.reward.mode === "fixed" ? <Units n={q.reward.amount} /> : <Badge tone="sunflower">{q.reward.mode === "approver_choice" ? t("approverChoice") : t("recognition")}</Badge>}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <form action={reviewSubmissionAction} className="flex flex-wrap items-center gap-2">
                  <KeyInput value={formKey()} />
                  <input type="hidden" name="submissionId" value={s.id} />
                  <input type="hidden" name="verdict" value="approve" />
                  {q.reward.mode === "approver_choice" ? <Input name="amount" type="number" min={1} required placeholder={t("amount")} aria-label={t("amountAria")} className="min-h-9 w-28 py-1" /> : null}
                  <Input name="note" placeholder={t("note")} aria-label={t("noteAria")} className="min-h-9 w-48 py-1" />
                  <Button size="sm" tone="mint"><Check className="size-4" /> {t("approve")}</Button>
                </form>
                <form action={reviewSubmissionAction} className="flex items-center gap-2">
                  <KeyInput value={formKey()} />
                  <input type="hidden" name="submissionId" value={s.id} />
                  <input type="hidden" name="verdict" value="reject" />
                  <Button size="sm" tone="danger" confirm={t("rejectConfirm")}><X className="size-4" /> {t("reject")}</Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
