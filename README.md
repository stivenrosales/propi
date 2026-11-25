# Propi

Open-source peer recognition for Slack: give "props" to teammates, track them in an append-only ledger, and redeem them in a shop. Self-hostable. Licensed AGPL-3.0.

Status: under construction. See `docs/plan.md`, `docs/spec.md` and `docs/architecture.md`.

## Development

```sh
pnpm install
docker compose -f deploy/docker-compose.dev.yml up -d   # Postgres on :55432
pnpm typecheck && pnpm test
```
