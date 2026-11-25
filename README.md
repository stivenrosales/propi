<p align="center">
  <img src="brand/logo/propi-logo.svg" alt="Propi" width="320" />
</p>

<p align="center">
  <strong>Say thanks. Make it count.</strong><br />
  Open-source peer recognition for Slack. Give props, track them in an append-only ledger, and redeem them in your team's shop.
</p>

<p align="center">
  <a href="https://propi.swnb5v.easypanel.host">Website</a> ·
  <a href="docs/spec.md">Spec</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/api.md">API</a> ·
  <a href="LICENSE">AGPL-3.0</a>
</p>

---

## What it is

Propi lets teammates thank each other in Slack with an emoji (🌮 by default, and you can pick your own). Every "prop" lands in a ledger: rows are only ever added, never edited. People spend what they receive in a shop that your team runs, and admins approve each redemption. It is a self-hosted, open-source alternative to closed per-seat recognition bots.

Your Propi runs on your own server, the data never leaves it, and there are no per-seat fees.

## Features

- **Give props in Slack.** Write `@ana thanks for the help :taco::taco:` or react with the emoji. You can thank several people at once.
  - Each person has a daily allowance with a clear private notice when it runs out.
  - Edits and deletes are handled correctly.
  - Mentioning a user group is a setting.
- **Configurable currency.** Pick your emoji, its name, and extra emojis worth more.
- **Company values.** Tag props with `#ownership` or a value emoji, and see who lives each value.
- **Shop with approvals.**
  - Rewards can have stock and variants, and you can set a monthly budget.
  - A redemption moves from pending to approved to fulfilled.
  - If a redemption is rejected or cancelled, the props are refunded automatically.
- **Collaborative rewards** that the team funds together, with refunds if the goal is not met.
- **Automatic awards.** For example, the "top receiver of the month gets +20", or giving streaks. Each period is evaluated exactly once.
- **Quests** with self-submission or nomination, proof, approval, caps and cooldowns.
- **Celebrations.** Birthdays and work anniversaries, posted publicly, privately or not at all, as each person prefers.
- **Leaderboards and insights.**
  - Filter by period, channel and value.
  - Alerts when someone hasn't been recognized for a while.
  - Checks for reciprocity patterns.
  - A monthly AI digest.
- **Stickers and levels.** Optional, with published rules.
- **REST API and signed webhooks**, so another system can handle delivery. For example, mark a redemption fulfilled from your ERP.
- **Import from HeyTaco.** The importer reproduces received, given and redeemable balances exactly, then verifies it.

## How it works

```
Slack ──► apps/server ─┐
Web UI ─► apps/web ────┼──► packages/app (use cases) ──► packages/core (pure rules)
REST API ──────────────┘            │
                                    ▼
                         packages/db (Postgres, append-only ledger)
```

- **One ledger.** Every balance change is one immutable row. Balances, allowances, levels and leaderboards are computed from it, never stored on the side.
- **One write path.** Every action becomes a command with a deterministic key. Retried Slack events, API calls and scheduled jobs never apply twice.
- **Pure domain.** `packages/core` has no I/O. All 109 rules in [`docs/spec.md`](docs/spec.md) are covered by tests named after them (`pnpm spec:coverage`).
- **Verified concurrency.** Parallel gifts and redemptions are tested against real Postgres.

For the full reasoning, see [`docs/architecture.md`](docs/architecture.md) and the state machines in [`docs/statecharts/`](docs/statecharts/), which are checked with TLA+.

## Self-hosting

You need Docker and a Slack workspace where you can create apps.

1. **Create the Slack app.** Go to <https://api.slack.com/apps?new_app=1> → *From a manifest*, paste [`deploy/slack-manifest.yml`](deploy/slack-manifest.yml) and install it to your workspace. Copy these values:
   - the **Bot token** (`xoxb-…`);
   - an **App-level token** with the `connections:write` scope (`xapp-…`);
   - for web sign-in, the **Client ID** and **Client secret**.
2. **Configure.** Copy `deploy/propi.env.example` to `propi.env` and fill in the values. Every variable is documented in that file.
3. **Run.** Use `docker compose` (or `docker stack deploy -c deploy/stack.yml propi` on Swarm). Migrations run before the server starts.
4. **Import your history (optional):**

   ```sh
   docker compose run --rm server node apps/cli/src/main.ts import /data/heytaco --until "2026-12-01T00:00:00-05:00"
   ```

   Then run `reconcile`. It must report `ok: true` with 0 diffs before you switch over.

Socket Mode is the default, so Slack needs no public URL. Only the web app does.

## Development

```sh
pnpm install
docker compose -f deploy/docker-compose.dev.yml up -d          # Postgres on 127.0.0.1:55433
export DATABASE_URL=postgresql://propi:propi@localhost:55433/propi
pnpm --filter @propi/db exec prisma migrate deploy
pnpm typecheck && pnpm test                                     # unit + Postgres contract and concurrency suites
pnpm spec:coverage                                              # rules from docs/spec.md with a test
pnpm --filter @propi/web dev                                    # web app on :3000
```

| Path | What lives there |
|---|---|
| `packages/core` | Pure domain rules, grouped by capability (giving, ledger, shop, rules, quests, …) |
| `packages/app` | Use cases: lock → claim command key → decide → commit; in-memory fakes for tests |
| `packages/db` | Prisma schema, SQL migrations (append-only triggers, sign checks), Postgres ports |
| `packages/slack` | Slack events ↔ commands and Block Kit rendering |
| `packages/heytaco` | HeyTaco export parsers |
| `apps/server` | Slack bot, outbox relay, webhooks, scheduler |
| `apps/web` | Landing, member area, admin, TV mode, REST API |
| `apps/cli` | Import and reconcile |
| `docs/` | Spec, architecture, API, statecharts |
| `brand/` | Logo, palette, mascot ([brand kit](brand/README.md)) |

## Status

Propi is under active development. The domain, persistence and HeyTaco migration are complete and tested, and the Slack bot and web app are being finished. The first production deployment is a team of about 15 people moving from HeyTaco.

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host Propi freely. If you offer a modified version as a service, you must publish your changes.
