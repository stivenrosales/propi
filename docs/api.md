# Propi REST API and webhooks

The API lets other systems read a workspace's recognition data and make a small set of writes: bonuses, deductions, redemption transitions and rewards. It covers spec rules S97–S100. Webhooks push events to your endpoints as they happen.

- **Base URL:** `https://<your-propi-host>/api/v1`
- **Format:** JSON in, JSON out. A success is `{ "data": … }`; a failure is `{ "error": { "code": "…", … } }`.
- **Source of truth:** the route table is `API_ROUTES` in `packages/core/src/api/resources.ts`. This page describes it.

## Authentication

Every request sends a bearer token:

```http
Authorization: Bearer propi_<token-id>.<secret>
```

Tokens work like this (S98):

- **Issued by an admin.** You see the plaintext once, when it is issued. Propi stores only its SHA-256 hash.
- **Scoped to one workspace.** A token always acts on the workspace it was issued for. The request cannot pick another one.
- **Explicit scopes.** A token can do only what its scopes allow. A missing scope returns `403 forbidden` with `need` naming the scope.
- **Revocable.** A revoked token returns `401 token_revoked`. An unknown or altered token returns `401 unauthenticated`.
- **Recorded as the actor.** Every write made with a token records that token as its actor in the audit log (S40), not the admin who issued it.

| Scope | Grants |
|---|---|
| `members:read` | list and read members |
| `ledger:read` | balances, gifts, ledger entries |
| `rewards:read` / `rewards:write` | read rewards / create, update, archive rewards |
| `redemptions:read` / `redemptions:write` | read redemptions / approve, reject, fulfil |
| `adjustments:write` | bonuses and deductions |
| `quests:read` | read quests |
| `leaderboards:read` | read leaderboards |

## Endpoints

### Reads

| Method and path | Scope | Returns |
|---|---|---|
| `GET /members` | `members:read` | every member: `id`, `role`, `active`, `daily_limit_override` |
| `GET /members/:id` | `members:read` | one member, or `404 unknown_member` |
| `GET /members/:id/balances` | `ledger:read` | `{ received, given, redeemable }` |
| `GET /gifts` | `ledger:read` | gifts |
| `GET /ledger-entries` | `ledger:read` | ledger entries in commit order |
| `GET /rewards`, `GET /rewards/:id` | `rewards:read` | rewards |
| `GET /redemptions`, `GET /redemptions/:id` | `redemptions:read` | redemptions |
| `GET /quests` | `quests:read` | quests |
| `GET /leaderboards/:board` | `leaderboards:read` | `received`, `given` or `combined` |

A read whose module is not wired into the server yet answers `501 not_implemented`.

### Writes

Each write maps to exactly one domain command. The rules for that command are the same ones Slack and the web app use: the API adds none and skips none.

| Method and path | Scope | Command | Body |
|---|---|---|---|
| `POST /bonuses` | `adjustments:write` | `GrantBonus` (S36) | `{ "member_ids": ["…"], "amount": 5, "reason": "…" }` |
| `POST /deductions` | `adjustments:write` | `Deduct` (S37) | `{ "member_id": "…", "amount": 2, "reason": "…" }` |
| `POST /redemptions/:id/approve` | `redemptions:write` | `TransitionRedemption` `approve` (S49) | `{}` |
| `POST /redemptions/:id/reject` | `redemptions:write` | `TransitionRedemption` `reject` (S51) | `{ "reason": "…" }` (optional) |
| `POST /redemptions/:id/fulfil` | `redemptions:write` | `TransitionRedemption` `fulfil` (S53) | `{}` |
| `POST /rewards` | `rewards:write` | `CreateReward` (S44) | reward fields (below); `title` and `cost` are required |
| `PATCH /rewards/:id` | `rewards:write` | `UpdateReward` (S44) | the editable fields to change |
| `DELETE /rewards/:id` | `rewards:write` | `SetRewardStatus` `archived` (S45) | none |

Reward fields: `title`, `description`, `image` (URL or `null`), `cost` (units), `stock` (`null` = unlimited), `variants` (`[{ "id", "name", "stock" }]`), `categories` (strings), `internal_cost` (`{ "minor": 2500, "currency": "PEN" }` or `null`), `instructions`, `auto_approve` (`true`, `false` or `null` for the workspace default) and `gift_card`. A new reward starts as a draft.

`PATCH` may change `title`, `description`, `image`, `cost`, `categories`, `internal_cost`, `instructions` and `auto_approve`. Stock, variants, gift-card mode and status have their own commands, so `PATCH` refuses them with `400 invalid_request`, as it does any unknown field. Redemptions already made keep the cost they were made at.

`DELETE` archives a reward; it never erases one. An archived reward keeps its redemption history and can no longer be edited.

A body with the wrong JSON types (for example `"amount": "2"`) returns `400 invalid_request` with the `field`. A business rejection, such as a deduction with an empty reason, returns `422` with the domain error code (`reason_required`).

## Idempotency

Every write must send an `Idempotency-Key` header (S100):

```http
Idempotency-Key: 7f9c1e52-erp-order-4411
```

- **Format.** 1–255 visible ASCII characters. A UUID works well.
- **Scope.** Keys belong to the token. Two tokens can use the same key without colliding.
- **Retries.** Retrying with the same key and the same body returns the original result and writes nothing new. The response carries `idempotent-replayed: true`.
- **Reuse.** The same key with a different body returns `422 idempotency_key_reused`.
- **Missing key.** A write without a key returns `400 idempotency_key_required`.

Fulfilment is idempotent twice over: marking an already fulfilled redemption fulfilled again is a no-op (S53).

## Errors

| Status | Codes |
|---|---|
| 400 | `invalid_request`, `invalid_scope`, `idempotency_key_required`, `invalid_idempotency_key` |
| 401 | `unauthenticated`, `token_revoked` |
| 403 | `forbidden` (with `need`) |
| 404 | `route_not_found`, `unknown_member`, `gift_not_found` |
| 422 | `idempotency_key_reused` and every other domain rejection |
| 501 | `not_implemented` |

## Webhooks

An admin registers an endpoint URL. Each endpoint gets its own signing secret and picks the events it wants, or all of them (S99).

### Events

| Family | Types |
|---|---|
| Gifts | `gift.given`, `gift.reversed` |
| Redemptions (S54) | `redemption.created`, `redemption.approved`, `redemption.rejected`, `redemption.cancelled`, `redemption.fulfilled` |
| Quest submissions | `quest.submission.created`, `quest.submission.approved`, `quest.submission.rejected` |
| Rule awards | `rule.awarded` |
| Member changes | `member.created`, `member.updated`, `member.deactivated` |

Internal events are never sent. Examples: the private over-allowance notice to a giver, and the admin audit trail.

### Payload

Each delivery is one `POST` with this JSON body:

```json
{
  "id": "evt_3f1c0a9b2d4e6f8a1b3c5d7e9f0a2b4c",
  "type": "gift.given",
  "created_at": "2026-11-25T15:00:00.000Z",
  "workspace_id": "ws_…",
  "data": { "giftId": "…", "giver": "…", "receivers": ["…"], "perReceiver": 3 }
}
```

Every delivery carries these headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Propi-Event-Id` | the same value as `id` |
| `X-Propi-Signature` | `t=<unix seconds>,v1=<hex>` |

### Delivery and retries

- **Success.** Any `2xx` response is a success.
- **Failure.** Anything else, a network error or a timeout, is a failure and is retried with exponential backoff: 1 min, 2, 4, 8, 16, 32, 64, 128, 256, 512 min, then 12 h.
- **Dead.** After 12 failed attempts the delivery is marked dead and stops.
- **At least once.** An event can arrive more than once. Its `id` never changes, so deduplicate on `id`.

### Verifying a delivery

`v1` is the hex HMAC-SHA256, keyed with the endpoint secret, of the timestamp, a dot, and the raw request body: `t + "." + body`. Verify against the raw bytes, before any JSON parsing. Reject timestamps more than 5 minutes old.

```js
// Node 18+, no dependencies.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const SECRET = process.env.PROPI_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;
const seen = new Set(); // use a durable store in production

function verify(rawBody, header, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Math.floor(now / 1000) - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", SECRET).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (!verify(raw, req.headers["x-propi-signature"] ?? "")) {
      res.writeHead(400).end();
      return;
    }
    const event = JSON.parse(raw);
    if (!seen.has(event.id)) {
      seen.add(event.id);
      console.log(event.type, event.data); // handle the event
    }
    res.writeHead(204).end(); // acknowledge fast; do slow work afterwards
  });
}).listen(3000);
```

## Platform identities

A member can link identities from several platforms, such as a Slack user and a Teams user (S107). The ledger only knows the member, so every linked identity shares one balance and one daily allowance. Platform adapters resolve an identity to its member and then send the same commands; they hold no business rules (S106).
