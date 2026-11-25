import { MessageCircle, Target } from "lucide-react";
import { StateBadge } from "@/components/app/state-badge";
import { Avatar, Badge, Button, Card, Empty, Field, Flash, Input, KeyInput, PageHeader, Select, Textarea, Units } from "@/components/app/ui";
import { formatDate } from "@/lib/format";
import { commentQuestAction, submitQuestAction } from "@/server/actions/member";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export const metadata = { title: "Quests" };

const rewardText = (r: { mode: string; amount?: number }) => (r.mode === "fixed" ? null : r.mode === "approver_choice" ? "Approver's choice" : "Recognition only");

// S64-S67: open quests, submitting for yourself or nominating a teammate, and the public timeline.
export default async function Quests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const store = propi().engagement.quests;
  const [quests, w] = await Promise.all([store.quests(viewer.ws), workspaceView(viewer.ws)]);
  const open = quests.filter((q) => q.state === "open");
  const subs = new Map(await Promise.all(open.map(async (q) => [q.id, await store.submissions(viewer.ws, q.id)] as const)));
  const teammates = w.members.filter((m) => m.active && m.id !== viewer.memberId);

  return (
    <>
      <PageHeader title="Quests" eyebrow="Earn extra props" />
      <Flash ok={sp.ok} error={sp.error} />
      {open.length === 0 ? (
        <Empty title="No open quests right now" art="/brand/mascot-thumbs-up.webp" />
      ) : (
        <div className="grid gap-5">
          {open.map((q) => {
            const all = subs.get(q.id) ?? [];
            const mine = all.filter((s) => s.memberId === viewer.memberId || s.submittedBy === viewer.memberId);
            const timeline = q.timeline ? all.filter((s) => s.state === "approved").slice(-5).reverse() : [];
            const text = rewardText(q.reward as { mode: string });
            return (
              <Card key={q.id}>
                <div className="flex flex-wrap items-start gap-4">
                  <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-mint-soft">
                    <Target className="size-7" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-xl font-extrabold">{q.title}</h2>
                    <p className="mt-1 text-sm text-ink-soft">{q.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {q.reward.mode === "fixed" ? <Badge tone="coral"><Units n={q.reward.amount} className="text-xs" /></Badge> : <Badge tone="sunflower">{text}</Badge>}
                      <Badge>{q.submitters === "both" ? "Self or nomination" : q.submitters === "self" ? "Self only" : "Nomination only"}</Badge>
                      {q.proofRequired ? <Badge>Proof required</Badge> : null}
                      {q.closesAt ? <Badge>Closes {formatDate(q.closesAt, w.settings.timezone)}</Badge> : null}
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <form action={submitQuestAction} className="flex flex-col gap-3 rounded-3xl bg-cream/70 p-4">
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="questId" value={q.id} />
                    {q.submitters !== "self" ? (
                      <Field label="Who completed it?">
                        <Select name="memberId" defaultValue={q.submitters === "nomination" ? (teammates[0]?.id ?? "") : ""}>
                          {q.submitters === "both" ? <option value="">Me</option> : null}
                          {teammates.map((m) => (
                            <option key={m.id} value={m.id}>{w.label(m.id)}</option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    <Field label={q.proofRequired ? "Proof (link or text)" : "Proof (optional)"}>
                      <Input name="proof" required={q.proofRequired} placeholder="https://…" />
                    </Field>
                    <Field label="Note (optional)">
                      <Textarea name="note" rows={2} />
                    </Field>
                    <Button className="self-start">Submit</Button>
                  </form>
                  <div>
                    <h3 className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">My submissions</h3>
                    {mine.length === 0 ? (
                      <p className="text-sm text-ink-soft">None yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {mine.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2 text-sm">
                            <span>
                              {s.memberId === viewer.memberId ? "You" : w.label(s.memberId)} · {formatDate(s.submittedAt, w.settings.timezone)}
                            </span>
                            <span className="flex items-center gap-2">
                              {s.reward > 0 ? <Units n={s.reward} className="text-xs" /> : null}
                              <StateBadge state={s.state} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {timeline.length > 0 ? (
                      <>
                        <h3 className="mt-5 mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">Timeline</h3>
                        <ul className="space-y-3">
                          {timeline.map((s) => (
                            <li key={s.id} className="rounded-2xl bg-cream/60 p-3">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <Avatar id={s.memberId} label={w.label(s.memberId)} src={w.avatar(s.memberId)} size="sm" /> {w.label(s.memberId)} completed it
                              </div>
                              <form action={commentQuestAction} className="mt-2 flex gap-2">
                                <KeyInput value={formKey()} />
                                <input type="hidden" name="submissionId" value={s.id} />
                                <Input name="text" required placeholder="Say congrats…" aria-label="Comment" />
                                <Button size="sm" tone="cream" aria-label="Post comment">
                                  <MessageCircle className="size-4" />
                                </Button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
