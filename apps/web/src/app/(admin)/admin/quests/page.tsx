import type { Quest } from "@propi/core/quests";
import { StateBadge } from "@/components/app/state-badge";
import { Badge, Button, Card, CardTitle, Checkbox, Empty, Field, Flash, Input, KeyInput, PageHeader, Select, Textarea, Units } from "@/components/app/ui";
import { defineQuestAction, questStateAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";

export const metadata = { title: "Quests" };

const day = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 10));

function QuestForm({ q }: { q?: Quest }) {
  return (
    <form action={defineQuestAction} className="grid gap-3 sm:grid-cols-2">
      <KeyInput value={formKey()} />
      <input type="hidden" name="questId" value={q?.id ?? ""} />
      <Field label="Title" className="sm:col-span-2"><Input name="title" defaultValue={q?.title} required /></Field>
      <Field label="Description" className="sm:col-span-2"><Textarea name="description" defaultValue={q?.description} rows={2} /></Field>
      <Field label="Image URL" className="sm:col-span-2"><Input name="image" type="url" defaultValue={q?.image ?? ""} /></Field>
      <Field label="Reward">
        <Select name="rewardMode" defaultValue={q?.reward.mode ?? "fixed"}>
          <option value="fixed">Fixed amount</option>
          <option value="approver_choice">Approver&apos;s choice</option>
          <option value="recognition">Recognition only</option>
        </Select>
      </Field>
      <Field label="Amount" hint="For a fixed reward"><Input name="rewardAmount" type="number" min={1} defaultValue={q?.reward.mode === "fixed" ? q.reward.amount : ""} /></Field>
      <Field label="Who submits">
        <Select name="submitters" defaultValue={q?.submitters ?? "both"}>
          <option value="self">Self</option>
          <option value="nomination">Nomination</option>
          <option value="both">Both</option>
        </Select>
      </Field>
      <Field label="Cooldown (hours)"><Input name="cooldownHours" type="number" min={0} defaultValue={q ? q.cooldownMs / 3_600_000 : 0} /></Field>
      <Field label="Per-person cap" hint="Empty for none"><Input name="perSubmitterCap" type="number" min={1} defaultValue={q?.perSubmitterCap ?? ""} /></Field>
      <Field label="Team cap" hint="Empty for none"><Input name="teamCap" type="number" min={1} defaultValue={q?.teamCap ?? ""} /></Field>
      <Field label="Opens"><Input name="opensAt" type="date" defaultValue={day(q?.opensAt ?? null)} /></Field>
      <Field label="Closes"><Input name="closesAt" type="date" defaultValue={day(q?.closesAt ?? null)} /></Field>
      <fieldset className="grid gap-2 sm:col-span-2">
        <Checkbox name="proofRequired" label="Proof required" defaultChecked={q?.proofRequired ?? false} />
        <Checkbox name="approvalRequired" label="Approval required" defaultChecked={q?.approvalRequired ?? true} />
        <Checkbox name="timeline" label="Public timeline with comments" defaultChecked={q?.timeline ?? true} />
      </fieldset>
      <Button size="sm" className="justify-self-start">{q ? "Save quest" : "Create draft"}</Button>
    </form>
  );
}

// S64-S65: define quests and move them draft → open → closed.
export default async function AdminQuests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const quests = await propi().engagement.quests.quests(viewer.ws);
  return (
    <>
      <PageHeader title="Quests" eyebrow="Admin">
        <a href="/admin/submissions" className="text-sm font-semibold text-coral hover:underline">Review submissions</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          {quests.length === 0 ? <Empty title="No quests yet" /> : null}
          {quests.map((q) => (
            <Card key={q.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-extrabold">{q.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <StateBadge state={q.state} />
                    {q.reward.mode === "fixed" ? <Badge tone="coral"><Units n={q.reward.amount} className="text-xs" /></Badge> : <Badge tone="sunflower">{q.reward.mode.replace("_", " ")}</Badge>}
                    <Badge>{q.submitters}</Badge>
                  </div>
                </div>
                {q.state !== "closed" ? (
                  <form action={questStateAction}>
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="questId" value={q.id} />
                    <input type="hidden" name="to" value={q.state === "draft" ? "open" : "closed"} />
                    <Button size="sm" tone={q.state === "draft" ? "mint" : "cream"}>{q.state === "draft" ? "Publish" : "Close"}</Button>
                  </form>
                ) : null}
              </div>
              {q.state === "draft" ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-coral">Edit</summary>
                  <div className="mt-3"><QuestForm q={q} /></div>
                </details>
              ) : null}
            </Card>
          ))}
        </div>
        <Card>
          <CardTitle>New quest</CardTitle>
          <QuestForm />
        </Card>
      </div>
    </>
  );
}
