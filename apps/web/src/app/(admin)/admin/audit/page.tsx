import { Badge, Card, Empty, PageHeader, Table, Td } from "@/components/app/ui";
import { auditPage } from "@/i18n/admin-audit.messages";
import { getLocale } from "@/i18n/locale";
import { formatDate } from "@/lib/format";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: auditPage.t(await getLocale())("title") };
}

const TONE = { bonus: "mint", deduction: "coral", reversal: "sunflower", reset: "ink" } as const;

// S40: every admin adjustment with actor, time and reason, straight from the command log.
export default async function Audit() {
  const viewer = await requireViewer("admin");
  const [log, w] = await Promise.all([propi().app.auditLog(viewer.ws), workspaceView(viewer.ws)]);
  const rows = [...log].reverse();
  const L = await getLocale();
  const t = auditPage.t(L);
  const actor = (a: (typeof rows)[number]["actor"]) =>
    a.kind === "member" ? w.label(a.memberId) : a.kind === "apiToken" ? t("token", { id: a.tokenId.slice(-6) }) : a.kind === "system" ? t("system", { job: a.job }) : t("bot");
  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
      <Card>
        {rows.length === 0 ? (
          <Empty title={t("empty")} />
        ) : (
          <Table head={[t("when"), t("action"), t("actor"), t("reason"), t("result")]}>
            {rows.map((r) => (
              <tr key={r.key}>
                <Td className="whitespace-nowrap text-ink-soft">{formatDate(L, r.at, w.settings.timezone, true)}</Td>
                <Td><Badge tone={TONE[r.action]}>{t(`action.${r.action}`)}</Badge></Td>
                <Td className="font-semibold">{actor(r.actor)}</Td>
                <Td className="max-w-md">{r.reason}</Td>
                <Td>{r.ok ? <Badge tone="mint">{t("applied")}</Badge> : <Badge>{t("refused")}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
