import { API_SCOPES, WEBHOOK_EVENT_TYPES } from "@propi/core";
import { RevealForm } from "@/components/app/reveal-form";
import { Badge, Button, Card, CardTitle, Checkbox, Empty, Field, Flash, Input, PageHeader, Table, Td } from "@/components/app/ui";
import { formatDate } from "@/lib/format";
import { createEndpointAction, issueTokenAction, revokeTokenAction, toggleEndpointAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";

export const metadata = { title: "API & webhooks" };

// S97-S99: issue and revoke API tokens; register webhook endpoints. Secrets are shown once.
export default async function ApiAdmin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  let unavailable: string | null = null;
  let tokens: Awaited<ReturnType<ReturnType<typeof p.tokens>["list"]>> = [];
  let endpoints: Awaited<ReturnType<ReturnType<typeof p.apiStores>["endpoints"]["list"]>> = [];
  try {
    [tokens, endpoints] = await Promise.all([p.tokens().list(viewer.ws), p.apiStores().endpoints.list(viewer.ws)]);
  } catch (err) {
    unavailable = err instanceof Error ? err.message : String(err);
  }
  const tz = (await p.ports.directory.settings(viewer.ws)).timezone;

  return (
    <>
      <PageHeader title="API & webhooks" eyebrow="Admin">
        <a href="https://github.com/stivenrosales/propi/blob/main/docs/api.md" className="text-sm font-semibold text-coral hover:underline" target="_blank" rel="noreferrer">API docs</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error ?? (unavailable ? `API features are unavailable: ${unavailable}` : undefined)} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardTitle>API tokens</CardTitle>
          {tokens.length === 0 ? (
            <Empty title="No tokens yet" />
          ) : (
            <Table head={["Name", "Scopes", "Created", ""]}>
              {tokens.map((t) => (
                <tr key={t.id} className={t.revokedAt ? "opacity-50" : ""}>
                  <Td className="font-semibold">{t.name}</Td>
                  <Td><div className="flex max-w-xs flex-wrap gap-1">{t.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</div></Td>
                  <Td className="whitespace-nowrap text-ink-soft">{formatDate(t.createdAt, tz)}</Td>
                  <Td>
                    {t.revokedAt ? (
                      <Badge>revoked</Badge>
                    ) : (
                      <form action={revokeTokenAction}>
                        <input type="hidden" name="tokenId" value={t.id} />
                        <Button size="sm" tone="danger">Revoke</Button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-6 border-t border-dashed border-line pt-5">
            <RevealForm action={issueTokenAction} submit="Issue token" note="Propi stores only its hash and will never show it again.">
              <Field label="Name" className="sm:col-span-2"><Input name="name" required placeholder="ERP integration" /></Field>
              <fieldset className="grid gap-1.5 sm:col-span-2 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-semibold">Scopes</legend>
                {API_SCOPES.map((s) => <Checkbox key={s} name="scopes" value={s} label={s} />)}
              </fieldset>
            </RevealForm>
          </div>
        </Card>
        <Card>
          <CardTitle>Webhook endpoints</CardTitle>
          {endpoints.length === 0 ? (
            <Empty title="No endpoints yet" />
          ) : (
            <ul className="divide-y divide-line">
              {endpoints.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{e.url}</p>
                    <p className="text-xs text-ink-soft">{e.events === "*" ? "All events" : e.events.join(", ")}</p>
                  </div>
                  <Badge tone={e.active ? "mint" : "muted"}>{e.active ? "active" : "paused"}</Badge>
                  <form action={toggleEndpointAction}>
                    <input type="hidden" name="endpointId" value={e.id} />
                    <Button size="sm" tone="cream">{e.active ? "Pause" : "Resume"}</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 border-t border-dashed border-line pt-5">
            <RevealForm action={createEndpointAction} submit="Add endpoint" note="Use it to verify the X-Propi-Signature header; it is not shown again.">
              <Field label="URL" className="sm:col-span-2"><Input name="url" type="url" required placeholder="https://example.com/propi-webhook" /></Field>
              <fieldset className="grid gap-1.5 sm:col-span-2 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-semibold">Events (none checked = all)</legend>
                {WEBHOOK_EVENT_TYPES.map((t) => <Checkbox key={t} name="events" value={t} label={t} />)}
              </fieldset>
            </RevealForm>
          </div>
        </Card>
      </div>
    </>
  );
}
