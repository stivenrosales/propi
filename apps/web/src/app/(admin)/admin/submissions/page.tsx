import { Check, X } from "lucide-react";
import { Avatar, Badge, Button, Card, Empty, Flash, Input, KeyInput, PageHeader, Units } from "@/components/app/ui";
import { formatDate } from "@/lib/format";
import { reviewSubmissionAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export const metadata = { title: "Submission review" };

// S66: approvers and admins approve or reject pending quest submissions, even after the quest closed.
export default async function Submissions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("approver");
  const sp = await searchParams;
  const store = propi().engagement.quests;
  const [quests, w] = await Promise.all([store.quests(viewer.ws), workspaceView(viewer.ws)]);
  const pending = (await Promise.all(quests.map(async (q) => (await store.submissions(viewer.ws, q.id)).filter((s) => s.state === "pending").map((s) => ({ q, s }))))).flat();
  return (
    <>
      <PageHeader title="Submission review" eyebrow="Review">
        <Badge tone="sunflower">{pending.length} waiting</Badge>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      {pending.length === 0 ? (
        <Empty title="Nothing to review" art="/brand/mascot-thumbs-up.webp" />
      ) : (
        <div className="grid gap-4">
          {pending.map(({ q, s }) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-start gap-4">
                <Avatar id={s.memberId} label={w.label(s.memberId)} />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-extrabold">{w.label(s.memberId)} · {q.title}</p>
                  <p className="text-sm text-ink-soft">
                    {s.submittedBy && s.submittedBy !== s.memberId ? `Nominated by ${w.label(s.submittedBy)} · ` : ""}
                    {formatDate(s.submittedAt, w.settings.timezone, true)}
                  </p>
                  {s.proof ? <p className="mt-2 text-sm break-all"><span className="font-semibold">Proof:</span> {/^https?:\/\//.test(s.proof) ? <a href={s.proof} target="_blank" rel="noreferrer noopener" className="text-coral underline">{s.proof}</a> : s.proof}</p> : null}
                  {s.note ? <p className="mt-1 text-sm">{s.note}</p> : null}
                </div>
                {q.reward.mode === "fixed" ? <Units n={q.reward.amount} /> : <Badge tone="sunflower">{q.reward.mode.replace("_", " ")}</Badge>}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <form action={reviewSubmissionAction} className="flex flex-wrap items-center gap-2">
                  <KeyInput value={formKey()} />
                  <input type="hidden" name="submissionId" value={s.id} />
                  <input type="hidden" name="verdict" value="approve" />
                  {q.reward.mode === "approver_choice" ? <Input name="amount" type="number" min={1} required placeholder="Amount" aria-label="Reward amount" className="min-h-9 w-28 py-1" /> : null}
                  <Input name="note" placeholder="Note (optional)" aria-label="Note" className="min-h-9 w-48 py-1" />
                  <Button size="sm" tone="mint"><Check className="size-4" /> Approve</Button>
                </form>
                <form action={reviewSubmissionAction} className="flex items-center gap-2">
                  <KeyInput value={formKey()} />
                  <input type="hidden" name="submissionId" value={s.id} />
                  <input type="hidden" name="verdict" value="reject" />
                  <Button size="sm" tone="danger"><X className="size-4" /> Reject</Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
