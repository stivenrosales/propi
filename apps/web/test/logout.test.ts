// Logging out lands on the public sign-in page. Behind the proxy the request URL carries the bind
// address (0.0.0.0:3000), so the redirect must be built from APP_URL.
import { afterEach, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/auth/logout/route.ts";
import { SESSION_COOKIE } from "../src/server/session.ts";

const prev = process.env.APP_URL;
afterEach(() => {
  if (prev === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prev;
});

describe("GET /auth/logout", () => {
  test("redirects to APP_URL/signin and clears the session cookie", () => {
    process.env.APP_URL = "https://propihq.com";
    const res = GET(new NextRequest("https://0.0.0.0:3000/auth/logout", { headers: { cookie: `${SESSION_COOKIE}=x` } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://propihq.com/signin");
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });
});
