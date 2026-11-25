// S97-S100: Next route handler ⇄ the framework-free ApiHttp from @propi/app. This only moves bytes:
// authentication, scopes, idempotency and every business rule stay in @propi/app and @propi/core.
import type { ApiHttp } from "@propi/app";

/** Request bodies above this size are refused before parsing. */
export const MAX_BODY_BYTES = 64 * 1024;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function handleApiRoute(req: Request, http: ApiHttp): Promise<Response> {
  const url = new URL(req.url);
  let body: unknown;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { error: { code: "invalid_request", field: "body" } });
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: { code: "invalid_request", field: "body" } });
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { error: { code: "invalid_request", field: "body" } });
      }
    } else {
      body = {};
    }
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  const res = await http.handle({ method: req.method, path: `${url.pathname}${url.search}`, headers, body });
  return json(res.status, res.body, { ...res.headers });
}
