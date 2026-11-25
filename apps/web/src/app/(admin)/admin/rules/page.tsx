import type { AwardRule } from "@propi/core/rules";
import { Badge, Button, Card, CardTitle, Empty, Field, Flash, Input, KeyInput, PageHeader, Select, Units } from "@/components/app/ui";
import { defineRuleAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";

export const metadata = { title: "Award rules" };

function criterionText(r: AwardRule, valueName: (id: string) => string): string {
  const c = r.criterion;
  switch (c.kind) {
    case "top_receivers":
      return `Top ${c.n} receiver${c.n === 1 ? "" : "s"}`;
    case "top_givers":
      return `Top ${c.n} giver${c.n === 1 ? "" : "s"}`;
    case "distinct_receivers":
      return `Gave to ${c.k}+ different people`;
    case "giving_streak":
      return `Gave in ${c.periods} periods in a row`;
    case "most_tagged":
      return `Most tagged with ${valueName(c.valueId)}`;
  }
}

function RuleForm({ r, values }: { r?: AwardRule; values: readonly { id: string; name: string }[] }) {
  const c = r?.criterion;
  const n = c === undefined ? 1 : "n" in c ? c.n : "k" in c ? c.k : "periods" in c ? c.periods : 1;
  return (
    <form action={defineRuleAction} className="grid gap-3 @lg:grid-cols-2">
      <KeyInput value={formKey()} />
      <input type="hidden" name="ruleId" value={r?.id ?? ""} />
      <Field label="Name" className="@lg:col-span-2"><Input name="name" defaultValue={r?.name} required /></Field>
      <Field label="Period">
        <Select name="period" defaultValue={r?.period ?? "month"}>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="quarter">Quarter</option>
        </Select>
      </Field>
      <Field label="Reward (units)"><Input name="reward" type="number" min={1} defaultValue={r?.reward} required /></Field>
      <Field label="Criterion">
        <Select name="criterion" defaultValue={c?.kind ?? "top_receivers"}>
          <option value="top_receivers">Top N receivers</option>
          <option value="top_givers">Top N givers</option>
          <option value="distinct_receivers">Gave to at least K people</option>
          <option value="giving_streak">Giving streak of P periods</option>
          <option value="most_tagged">Most tagged with a value</option>
        </Select>
      </Field>
      <Field label="N / K / P"><Input name="n" type="number" min={1} defaultValue={n} /></Field>
      <Field label="Value" hint="For the most-tagged criterion">
        <Select name="valueId" defaultValue={c?.kind === "most_tagged" ? c.valueId : ""}>
          <option value="">None</option>
          {values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Field>
      <Field label="Ties">
        <Select name="ties" defaultValue={r?.ties ?? "all_win"}>
          <option value="all_win">All tied members win</option>
          <option value="skip_tied">Skip a tie at the cut</option>
        </Select>
      </Field>
      <Field label="Announce in channel" hint="Channel id; empty for DMs only"><Input name="announceChannel" defaultValue={r?.announceChannel ?? ""} /></Field>
      <Field label="Status">
        <Select name="active" defaultValue={r?.active === false ? "false" : "true"}>
          <option value="true">Active</option>
          <option value="false">Paused</option>
        </Select>
      </Field>
      <Button size="sm" className="justify-self-start">{r ? "Save rule" : "Create rule"}</Button>
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
  return (
    <>
      <PageHeader title="Award rules" eyebrow="Admin" />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          {rules.length === 0 ? <Empty title="No award rules yet">Rules give props automatically, for example on work anniversaries. Add one with the form.</Empty> : null}
          {rules.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-extrabold">{r.name}</p>
                  <p className="text-sm text-ink-soft">Every {r.period} · {criterionText(r, valueName)} · {r.ties === "all_win" ? "ties all win" : "ties skipped"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Units n={r.reward} />
                  <Badge tone={r.active ? "mint" : "muted"}>{r.active ? "active" : "paused"}</Badge>
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-coral-ink">Edit</summary>
                <div className="mt-3"><RuleForm r={r} values={values} /></div>
              </details>
            </Card>
          ))}
        </div>
        <Card>
          <CardTitle>New rule</CardTitle>
          <RuleForm values={values} />
        </Card>
      </div>
    </>
  );
}
