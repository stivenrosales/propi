import { Avatar, Badge, Button, Card, Checkbox, Flash, Input, PageHeader, Select, Table, Td, Units } from "@/components/app/ui";
import { saveMemberAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { canChangeRoleOf } from "@/server/roles";
import { workspaceView } from "@/server/views";

export const metadata = { title: "Members" };

// S5-S7 roles and activation, S25 per-member allowance, S80 hide from boards.
export default async function Members({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  const [w, insights] = await Promise.all([workspaceView(viewer.ws), p.insights.source.settings(viewer.ws)]);
  const balances = new Map(await Promise.all(w.members.map(async (m) => [m.id, await p.app.balances(viewer.ws, m.id)] as const)));
  const excluded = new Set(insights.excludedFromBoards);
  const members = [...w.members].sort((a, b) => Number(b.active) - Number(a.active) || w.label(a.id).localeCompare(w.label(b.id)));

  return (
    <>
      <PageHeader title="Members" eyebrow="Admin">
        <Badge tone="mint">{members.filter((m) => m.active).length} active</Badge>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <p className="mb-4 text-sm text-ink-soft">People join through Slack. Here you set roles, allowances and visibility. You cannot change your own role.</p>
        <Table head={["Member", "Balances", "Role", "Allowance", "Status", ""]}>
          {members.map((m) => {
            const b = balances.get(m.id)!;
            const self = !canChangeRoleOf(viewer, m.id);
            const form = `member-${m.id}`;
            return (
              <tr key={m.id} className={m.active ? "" : "opacity-60"}>
                <Td>
                  <form id={form} action={saveMemberAction}>
                    <input type="hidden" name="memberId" value={m.id} />
                  </form>
                  <div className="flex items-center gap-3">
                    <Avatar id={m.id} label={w.label(m.id)} src={w.avatar(m.id)} size="sm" />
                    <div>
                      <p className="font-semibold">{w.label(m.id)}</p>
                      <p className="text-xs text-ink-soft">{m.id}</p>
                    </div>
                  </div>
                </Td>
                <Td className="text-xs whitespace-nowrap">
                  <Units n={b.redeemable} className="text-sm" />
                  <span className="block text-ink-soft">{b.received} in · {b.given} out</span>
                </Td>
                <Td>
                  {self ? (
                    <>
                      <input type="hidden" form={form} name="role" value={m.role} />
                      <Badge tone="ink">{m.role} (you)</Badge>
                    </>
                  ) : (
                    <Select form={form} name="role" defaultValue={m.role} aria-label={`Role of ${w.label(m.id)}`} className="min-h-9 py-1 text-sm">
                      <option value="member">Member</option>
                      <option value="approver">Approver</option>
                      <option value="admin">Admin</option>
                    </Select>
                  )}
                </Td>
                <Td>
                  <Input form={form} name="dailyLimitOverride" type="number" min={1} defaultValue={m.dailyLimitOverride ?? ""} placeholder="Default" aria-label="Daily allowance override" className="min-h-9 w-24 py-1 text-sm" />
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    {self ? <input type="hidden" form={form} name="active" value="on" /> : <Checkbox form={form} name="active" label="Active" defaultChecked={m.active} />}
                    <Checkbox form={form} name="excluded" label="Hide from boards" defaultChecked={excluded.has(m.id)} />
                  </div>
                </Td>
                <Td>
                  <Button form={form} size="sm" tone="cream">Save</Button>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
