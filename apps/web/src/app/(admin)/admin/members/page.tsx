import { Lock } from "lucide-react";
import { Avatar, Badge, Button, Card, Checkbox, Flash, Input, PageHeader, Select, Table, Td, Units } from "@/components/app/ui";
import { shell } from "@/i18n/app-shell.messages";
import { membersPage } from "@/i18n/admin-members.messages";
import { getLocale } from "@/i18n/locale";
import { saveMemberAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { canChangeRoleOf } from "@/server/roles";
import { workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: membersPage.t(await getLocale())("title") };
}

// S5-S7 roles and activation, S25 per-member allowance, S80 hide from boards.
export default async function Members({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  const L = await getLocale();
  const t = membersPage.t(L);
  const st = shell.t(L);
  const [w, insights] = await Promise.all([workspaceView(viewer.ws), p.insights.source.settings(viewer.ws)]);
  const balances = new Map(await Promise.all(w.members.map(async (m) => [m.id, await p.app.balances(viewer.ws, m.id)] as const)));
  const excluded = new Set(insights.excludedFromBoards);
  const members = [...w.members].sort((a, b) => Number(b.active) - Number(a.active) || w.label(a.id).localeCompare(w.label(b.id)));

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <Badge tone="mint">{t("activeCount", { count: members.filter((m) => m.active).length })}</Badge>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <p className="mb-4 text-sm text-ink-soft">{t("intro")}</p>
        <Table head={[t("member"), t("balances"), t("role"), t("allowance"), t("status"), ""]}>
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
                    <p className="font-semibold whitespace-nowrap">{w.label(m.id)}</p>
                  </div>
                </Td>
                <Td className="text-xs whitespace-nowrap">
                  <Units n={b.redeemable} className="text-sm" />
                  <span className="block text-ink-soft">{t("inOut", { received: b.received, given: b.given })}</span>
                </Td>
                <Td>
                  {self ? (
                    <>
                      <input type="hidden" form={form} name="role" value={m.role} />
                      <span title={t("ownRole")} className="inline-flex min-h-9 w-36 items-center gap-1.5 rounded-xl border border-dashed border-line px-3 text-sm font-semibold text-ink-soft">
                        <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                        {t("you", { role: st(`role.${m.role}`) })}
                      </span>
                    </>
                  ) : (
                    <Select form={form} name="role" defaultValue={m.role} aria-label={t("roleOf", { name: w.label(m.id) })} className="min-h-9 w-36 py-1 text-sm">
                      <option value="member">{st("role.member")}</option>
                      <option value="approver">{st("role.approver")}</option>
                      <option value="admin">{st("role.admin")}</option>
                    </Select>
                  )}
                </Td>
                <Td>
                  <Input form={form} name="dailyLimitOverride" type="number" min={1} defaultValue={m.dailyLimitOverride ?? ""} placeholder={t("default")} aria-label={t("override")} className="min-h-9 w-24 py-1 text-sm" />
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    {self ? (
                      <>
                        <input type="hidden" form={form} name="active" value="on" />
                        <span title={t("deactivateSelf")} className="flex">
                          <Checkbox label={t("active")} checked disabled readOnly className="whitespace-nowrap" />
                        </span>
                      </>
                    ) : (
                      <Checkbox form={form} name="active" label={t("active")} defaultChecked={m.active} className="whitespace-nowrap" />
                    )}
                    <Checkbox form={form} name="excluded" label={t("hide")} defaultChecked={excluded.has(m.id)} className="whitespace-nowrap" />
                  </div>
                </Td>
                <Td>
                  <Button form={form} size="sm" tone="cream">{t("save")}</Button>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
