import { API_SCOPES, WEBHOOK_EVENT_TYPES } from "@propi/core";
import { RevealForm } from "@/components/app/reveal-form";
import { Badge, Button, Card, CardTitle, Checkbox, Empty, Field, Flash, Input, PageHeader, Table, Td } from "@/components/app/ui";
import { apiPage } from "@/i18n/admin-api.messages";
import { getLocale } from "@/i18n/locale";
import { formatDate } from "@/lib/format";
import { createEndpointAction, issueTokenAction, revokeTokenAction, toggleEndpointAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";

export async function generateMetadata() {
  return { title: apiPage.t(await getLocale())("title") };
}

// S97-S99: issue and revoke API tokens; register webhook endpoints. Secrets are shown once.
export default async function ApiAdmin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  const L = await getLocale();
  const t = apiPage.t(L);
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
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <a href="https://github.com/stivenrosales/propi/blob/main/docs/api.md" className="text-sm font-semibold text-coral-ink hover:underline" target="_blank" rel="noreferrer">{t("docs")}</a>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error ?? (unavailable ? t("unavailable", { reason: unavailable }) : undefined)} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardTitle>{t("tokens")}</CardTitle>
          {tokens.length === 0 ? (
            <Empty title={t("noTokens")} />
          ) : (
            <Table head={[t("name"), t("scopes"), t("created"), ""]}>
              {tokens.map((tk) => (
                <tr key={tk.id} className={tk.revokedAt ? "opacity-50" : ""}>
                  <Td className="font-semibold">{tk.name}</Td>
                  <Td><div className="flex max-w-xs flex-wrap gap-1">{tk.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</div></Td>
                  <Td className="whitespace-nowrap text-ink-soft">{formatDate(L, tk.createdAt, tz)}</Td>
                  <Td>
                    {tk.revokedAt ? (
                      <Badge>{t("revoked")}</Badge>
                    ) : (
                      <form action={revokeTokenAction}>
                        <input type="hidden" name="tokenId" value={tk.id} />
                        <Button size="sm" tone="danger" confirm={t("revokeConfirm")}>{t("revoke")}</Button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-6 border-t border-dashed border-line pt-5">
            <RevealForm action={issueTokenAction} submit={t("issue")} note={t("issueNote")}>
              <Field label={t("name")} className="sm:col-span-2"><Input name="name" required placeholder={t("namePlaceholder")} /></Field>
              <fieldset className="grid gap-1.5 sm:col-span-2 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-semibold">{t("scopes")}</legend>
                {API_SCOPES.map((s) => <Checkbox key={s} name="scopes" value={s} label={s} />)}
              </fieldset>
            </RevealForm>
          </div>
        </Card>
        <Card>
          <CardTitle>{t("endpoints")}</CardTitle>
          {endpoints.length === 0 ? (
            <Empty title={t("noEndpoints")} />
          ) : (
            <ul className="divide-y divide-line">
              {endpoints.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{e.url}</p>
                    <p className="text-xs text-ink-soft">{e.events === "*" ? t("allEvents") : e.events.join(", ")}</p>
                  </div>
                  <Badge tone={e.active ? "mint" : "muted"}>{e.active ? t("active") : t("paused")}</Badge>
                  <form action={toggleEndpointAction}>
                    <input type="hidden" name="endpointId" value={e.id} />
                    <Button size="sm" tone="cream">{e.active ? t("pause") : t("resume")}</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 border-t border-dashed border-line pt-5">
            <RevealForm action={createEndpointAction} submit={t("add")} note={t("addNote")}>
              <Field label="URL" className="sm:col-span-2"><Input name="url" type="url" required placeholder="https://example.com/propi-webhook" /></Field>
              <fieldset className="grid gap-1.5 sm:col-span-2 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-semibold">{t("events")}</legend>
                {WEBHOOK_EVENT_TYPES.map((ev) => <Checkbox key={ev} name="events" value={ev} label={ev} />)}
              </fieldset>
            </RevealForm>
          </div>
        </Card>
      </div>
    </>
  );
}
