# apps/server

The long-running Propi process (architecture §2.4): the Slack receiver (Bolt), the outbox relay and the minute scheduler, in one Node 24 process. It also has the HeyTaco import into Postgres.

```sh
node apps/server/src/main.ts                      # serve (needs the variables in env.example)
node apps/server/src/main.ts import <dir> --team <T…> [--until <timestamp>]
```

## How a Slack event becomes a gift

1. Bolt receives the event. `packages/slack` translates it into an app command with its §1.7 key (`slack:msg:…`, `slack:edit:…`, `slack:del:…`, `slack:react:…`, `slack:unreact:…`). It resolves `<@U…>` mentions and expands user groups through the Slack API (S12).
2. `app.execute(command)` runs locks, claim, decide and commit in one transaction. Every rule is decided in core (S106).
3. **G7:** the event is acknowledged only after `execute` committed. Bolt acks Events API requests before listeners run, so `deferEventAcks` (src/bolt.ts) sends the ack after the listener finishes. In Socket Mode and in HTTP mode (`processBeforeResponse: true`) a failed event stays unacknowledged, Slack retries, and `command_log` replays. Events slower than 1.5 s are logged as `slow event`. If p99 ever approaches 3 s, the fallback is an insert-before-ack inbox (architecture G7).
4. The relay claims the committed `domain_event` rows (one receipt per consumer, in the same transaction) and sends the DMs and posts. Core decides who gets what: notify plans with S85 preferences, the `notify` lists on events, and `canApprove` for approvers.

Some results are silent: `not_a_gift`, `gift_closed` and `gift_not_found` (S9, S23). An over-allowance gift is answered by the outbox: core emits `gift.rejected`, and the giver gets the S13 notice once, even if Slack retries.

## Members

A human Slack user who is not linked yet is provisioned as a `member` the first time they appear, and their identity is linked (S107). The member id is derived from the identity, so two concurrent first sightings create one member. Bots (`is_bot`, `bot_id`) are never members (S8). The installer from `SLACK_INSTALLER_USER_ID` becomes the first admin on the first start (S5). `app_uninstalled` stamps the installation and keeps every row (S72).

## Scheduler (src/due.ts, src/scheduler.ts)

Every minute, for each installed workspace. Command keys make every job exactly-once across restarts and replicas.

| Job | When (workspace local time) | Key |
|---|---|---|
| Rule evaluation (S61, S62) | core `rulesDue` | `rule:<id>:<period>` |
| Celebrations (S93, S94) | core `celebrationsDue` | `milestone:…` |
| Pairing round (S95) | core round of the cadence | core pairing key |
| Weekly report (S84), isolation alert (S89) | Monday from 09:00 | `job:report:…`, `job:isolation:…` |
| Nudge (S86) | core's nudge weekday, from 15:00 | `job:nudge:…` |
| Reciprocity review (S90), AI digest (S91) | days 1–3 of the month from 09:00, for the previous month | `job:reciprocity:…`, `job:digest:…` |
| Collab deadlines (S58) | every 15 min | `collab:<id>:refund` |
| Gift-card relay (S108) | every tick, when a provider is configured | `giftcard:<id>:issued` |
| Ledger check (S34) | nightly after 02:00 | logged, not stored |

Periodic notification plans are stored through one `RecordNotifications` command (src/jobs.ts). It turns each plan into `notify` outbox events, so the relay delivers them like any other event. The digest runs only when `OPENROUTER_API_KEY` is set; without it, it is skipped and logged once.

## Container

`apps/server/Dockerfile` builds from the repo root. `RUN_MIGRATIONS=true`, or the `migrate` command, runs `prisma migrate deploy` first. `deploy/stack.yml` runs `postgres`, a one-shot `migrate`, `server` and `web`, all reading `/opt/propi/propi.env` (`web` joins the `propi` network to reach `postgres:5432`). `/healthz` on `PORT` returns 200 when Postgres answers and Slack is connected. Without `SLACK_BOT_TOKEN` the server logs `Slack not configured: set SLACK_BOT_TOKEN/SLACK_APP_TOKEN; running health only` and serves only `/healthz` (200 with `"slack": "not_configured"` when Postgres answers), so a deploy waiting for the Slack app's tokens does not restart-loop.
