import { Badge, Card, Empty, PageHeader, Table, Td } from "@/components/app/ui";
import { formatDate } from "@/lib/format";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";
import { workspaceView } from "@/server/views";

export const metadata = { title: "Audit log" };

const TONE = { bonus: "mint", deduction: "coral", reversal: "sunflower", reset: "ink" } as const;

// S40: every admin adjustment with actor, time and reason, straight from the command log.
export default async function Audit() {
  const viewer = await requireViewer("admin");
  const [log, w] = await Promise.all([propi().app.auditLog(viewer.ws), workspaceView(viewer.ws)]);
  const rows = [...log].reverse();
  const actor = (a: (typeof rows)[number]["actor"]) =>
    a.kind === "member" ? w.label(a.memberId) : a.kind === "apiToken" ? `API token ${a.tokenId.slice(-6)}` : a.kind === "system" ? `System (${a.job})` : "Bot";
  return (
    <>
      <PageHeader title="Audit log" eyebrow="Admin" />
      <Card>
        {rows.length === 0 ? (
          <Empty title="No adjustments yet" />
        ) : (
          <Table head={["When", "Action", "Actor", "Reason", "Result"]}>
            {rows.map((r) => (
              <tr key={r.key}>
                <Td className="whitespace-nowrap text-ink-soft">{formatDate(r.at, w.settings.timezone, true)}</Td>
                <Td><Badge tone={TONE[r.action]}>{r.action}</Badge></Td>
                <Td className="font-semibold">{actor(r.actor)}</Td>
                <Td className="max-w-md">{r.reason}</Td>
                <Td>{r.ok ? <Badge tone="mint">applied</Badge> : <Badge>refused</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
