// S11: the server's Polar client, only for seat sync. A minimal fetch client local to the server: the
// web app's Polar adapter (checkout, portal, webhooks) lives in apps/web and a composition root never
// imports another one. Needs a Polar token with the subscriptions:write scope.
// API: PATCH /v1/subscriptions/{id} with { seats } (proration per the organization's default).
import type { SeatUpdater } from "@propi/app";

export interface PolarSeatsConfig {
  readonly accessToken: string;
  readonly apiBase: string;
}

/** Same switch as the web app: billing is on only when all three POLAR_* vars are set. */
export function polarSeatsConfig(env: Readonly<Record<string, string | undefined>> = process.env): PolarSeatsConfig | null {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (!accessToken || !env.POLAR_WEBHOOK_SECRET?.trim() || !env.POLAR_PRO_PRODUCT_ID?.trim()) return null;
  return { accessToken, apiBase: env.POLAR_SERVER === "production" ? "https://api.polar.sh" : "https://sandbox-api.polar.sh" };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function polarSeatUpdater(cfg: PolarSeatsConfig, fetcher: Fetch = fetch): SeatUpdater {
  return {
    async updateSeats(subscriptionId, seats) {
      const path = `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`;
      const res = await fetcher(`${cfg.apiBase}${path}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ seats }),
      });
      if (!res.ok) throw new Error(`Polar API ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
    },
  };
}
