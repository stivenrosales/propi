// S11: the server's Polar seat client (PATCH /v1/subscriptions/{id} with { seats }) and its env config.
import { describe, expect, test } from "vitest";
import { polarSeatUpdater, polarSeatsConfig } from "../src/polar.ts";

describe("S11 Polar seat client", () => {
  test("updates seats with PATCH /v1/subscriptions/{id}, the bearer token and only the seats field", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "sub_1", seats: 14 }), { status: 200 });
    };
    await polarSeatUpdater({ accessToken: "polar_oat_x", apiBase: "https://sandbox-api.polar.sh" }, fetcher).updateSeats("sub_1", 14);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://sandbox-api.polar.sh/v1/subscriptions/sub_1");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer polar_oat_x");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ seats: 14 });
  });

  test("a Polar error is thrown with its status so the sync reports it", async () => {
    const fetcher = async () => new Response('{"detail":"insufficient_scope"}', { status: 403 });
    await expect(polarSeatUpdater({ accessToken: "t", apiBase: "https://api.polar.sh" }, fetcher).updateSeats("sub_1", 2)).rejects.toThrow("Polar API 403");
  });

  test("config needs the three POLAR_* vars; POLAR_SERVER=production selects the live API", () => {
    const env = { POLAR_ACCESS_TOKEN: "t", POLAR_WEBHOOK_SECRET: "s", POLAR_PRO_PRODUCT_ID: "p" };
    expect(polarSeatsConfig({})).toBeNull();
    expect(polarSeatsConfig({ ...env, POLAR_PRO_PRODUCT_ID: "" })).toBeNull();
    expect(polarSeatsConfig(env)).toEqual({ accessToken: "t", apiBase: "https://sandbox-api.polar.sh" });
    expect(polarSeatsConfig({ ...env, POLAR_SERVER: "production" })).toEqual({ accessToken: "t", apiBase: "https://api.polar.sh" });
  });
});
