import { Gift, MinusCircle, RotateCcw, Undo2 } from "lucide-react";
import { Button, Card, CardTitle, Field, Flash, Input, KeyInput, PageHeader, Select, Textarea } from "@/components/app/ui";
import { formatDate, readableText } from "@/lib/format";
import { bonusAction, deductAction, resetAllAction, reverseGiftAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export const metadata = { title: "Adjustments" };

// S36 bonus, S37 deduction, S38 gift reversal, S39 bulk reset. Every one lands in the audit log (S40).
export default async function Adjustments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const [w, recent] = await Promise.all([workspaceView(viewer.ws), propi().boards.feed(viewer.ws, { limit: 40 })]);
  const active = w.members.filter((m) => m.active);
  const options = active.map((m) => (
    <option key={m.id} value={m.id}>{w.label(m.id)}</option>
  ));

  return (
    <>
      <PageHeader title="Adjustments" eyebrow="Admin">
        <a href="/admin/audit" className="text-sm font-semibold text-coral hover:underline">See the audit log</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle><span className="inline-flex items-center gap-2"><Gift className="size-5 text-mint" /> Bonus</span></CardTitle>
          <form action={bonusAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label="Members" hint="Hold Cmd or Ctrl to pick several">
              <Select name="memberIds" multiple required className="min-h-36">{options}</Select>
            </Field>
            <Field label="Amount each"><Input name="amount" type="number" min={1} required /></Field>
            <Field label="Reason"><Input name="reason" required placeholder="Hackathon winners" /></Field>
            <Button tone="mint" className="justify-self-start">Grant bonus</Button>
          </form>
        </Card>
        <Card>
          <CardTitle><span className="inline-flex items-center gap-2"><MinusCircle className="size-5 text-coral" /> Deduction</span></CardTitle>
          <form action={deductAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label="Member"><Select name="memberId" required>{options}</Select></Field>
            <Field label="Amount"><Input name="amount" type="number" min={1} required /></Field>
            <Field label="Reason" hint="Required"><Input name="reason" required /></Field>
            <Button tone="coral" className="justify-self-start">Deduct</Button>
          </form>
        </Card>
        <Card>
          <CardTitle><span className="inline-flex items-center gap-2"><Undo2 className="size-5" /> Reverse a gift</span></CardTitle>
          <form action={reverseGiftAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label="Gift" hint="Recent public gifts. The giver's allowance is not restored.">
              <Select name="giftId" required>
                {recent.map((g) => (
                  <option key={g.giftId} value={g.giftId}>
                    {formatDate(g.at, w.settings.timezone)} · {w.label(g.giver)} → {g.receivers.map((r) => w.label(r.memberId)).join(", ")} ({g.units}){g.text ? ` · ${readableText(g.text).slice(0, 40)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason"><Input name="reason" required /></Field>
            <Button tone="cream" className="justify-self-start">Reverse gift</Button>
          </form>
        </Card>
        <Card className="border-coral">
          <CardTitle><span className="inline-flex items-center gap-2"><RotateCcw className="size-5 text-coral" /> Reset all balances</span></CardTitle>
          <p className="mb-3 text-sm text-ink-soft">Sets everyone&apos;s redeemable balance to 0 with one deduction per member. Received totals and history stay.</p>
          <form action={resetAllAction} className="grid gap-3">
            <KeyInput value={formKey()} />
            <Field label="Reason"><Textarea name="reason" required rows={2} /></Field>
            <Field label='Type "RESET" to confirm'><Input name="confirm" required pattern="RESET" autoComplete="off" /></Field>
            <Button tone="danger" className="justify-self-start">Reset everyone</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
