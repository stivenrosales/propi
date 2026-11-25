# Peer Recognition Platform — Master Plan

Open-source, self-hostable peer-recognition app for Slack (Teams later). Feature parity with HeyTaco plus the gaps it leaves. First customer: Pearson (currently on HeyTaco, channel `#tacos`, ~15 people, ~200 gifts/month).
Working name: TBD (decided last). The codebase never says "taco".

## Phase A — Frame

### Definition of done (falsifiable)

The product is done when all of these hold, each checked on the real artifact:

1. **Migration parity:** importing Pearson's HeyTaco export yields per-person `received` and `redeemable` balances whose diff against HeyTaco's export is 0.
2. **Spec coverage:** every numbered rule `S#` in `docs/spec.md` has at least one passing behavior test through the public domain API.
3. **Live cutover:** Pearson's `#tacos` runs on this app for 2 consecutive weeks with HeyTaco uninstalled, zero lost gifts (every gift message in the channel has a ledger entry; checked by a replay script over channel history).
4. **Integration:** Pearson Projects receives redemption webhooks and marks one real redemption `fulfilled` through the public API.
5. **Self-host:** a fresh machine runs the app from the README with `docker compose up` and one Slack app manifest.

### Settled decisions (from the research conversation)

| # | Decision | Why |
|---|---|---|
| D1 | Full scope, not an MVP | User request |
| D2 | Currency is configurable per workspace (emoji, singular/plural name, extra emojis with other values); domain is currency-agnostic | Pearson keeps 🌮; other adopters choose their own |
| D3 | Approval/rejection and balances live in the app; fulfillment is delegated through REST API + webhooks (Pearson Projects is one client) | Refund-on-reject must be atomic with the ledger |
| D4 | Rule-based automatic awards (e.g. monthly top receiver bonus, streaks) | Not offered by HeyTaco |
| D5 | Open source, self-hostable | User goal |
| D6 | Name and branding decided last | User request |

### Scope (units)

| Area | Units | Notes |
|---|---|---|
| Core domain: workspace, member, currency, gift (message/reaction, multi-recipient, edit handling), daily allowance with TZ reset, self-gift ban, over-limit feedback | 4 | Pure TS, no I/O |
| Ledger: append-only entries, `received`/`redeemable` projections, admin bonus, deduction, reversal, transfer, bulk reset, audit | 3 | Highest correctness risk |
| Values/tags on gifts | 1 | Emoji or hashtag → value |
| Rewards shop: catalog, stock, variants, categories, redemption state machine (pending → approved → fulfilled / rejected → refunded), collaborative rewards, budgets | 4 | Statechart |
| Automatic award rules engine (scheduled, period-based) | 2 | Idempotent per period |
| Quests (self-submit/nomination, proof, approval, cooldowns, limits, templates) | 3 | Statechart |
| Milestones: birthdays, anniversaries, per-person visibility, local-time scheduling | 2 | |
| Gamification: special stickers with transparent rules, levels, avatars | 2 | Rules published, not secret |
| Leaderboards and reports: period/channel/value filters, weekly DM report, Taco-TV-style display | 2 | |
| Insights: manager alerts (no recognition in N weeks), reciprocity/abuse detection, AI monthly digest | 3 | AI via Vercel AI SDK + OpenRouter |
| Pairing chats (match people who interact least) | 1 | |
| Adapters: Postgres persistence (Prisma), Slack (Bolt, events + interactivity + App Home shop), REST API + signed webhooks, Next.js web (admin, shop, dashboards) | 8 | |
| HeyTaco migration importer + reconciliation script | 2 | Riskiest external unknown |
| Teams adapter | 3 | Last |
| Gift-card provider adapter (optional) | 1 | Low value in Peru |
| OSS packaging: Docker, Slack manifest, docs, license, CI | 2 | |
| **Total** | **~43 units** | Roughly 8–12 weeks of focused work |

### Pearson's live HeyTaco setup (verified in the admin UI, 2026-11-24)

- Plan: Classic ($3/person/month), 15 users, installed 2023-09-17. Cancelling permanently deletes all data, so the export must happen first.
- History: 5,093 tacos given all-time; 212 this month.
- Giving: 5/day default with per-person overrides (one member at 8, one at 10); separate daily limit for admins; reactions ON; bots may give; private channels configurable; message content saved.
- Bot sits in 8 channels (operaciones, finanzas, tecnologia-automatizaciones, administracion, tacos, direccion [private], sesiones, delegaciones). Activity can be filtered by channel.
- Activity feed logs message gifts ("X gave 3 tacos to Y") and reactions as separate entries ("X gave 1 taco reaction to Y").
- Shop: 9 custom rewards, all cash-equivalent vouchers in soles (12 tacos ≈ S/20–25; books 20 tacos ≈ up to S/50). Redemptions: list with Unfulfilled/Fulfilled filter, "Mark fulfilled", and "Manual Redemption"; ~15 pages of history with old unfulfilled items. So the real fulfillment step is payment of a cash voucher, which is what Pearson Projects should own (D3).
- Bonuses: admin-only, go to redeemable, excluded from leaderboard/stickers/levels; none used yet.
- Quests: enabled, 0 created. Config: reward fixed / approver's choice / recognition only; submit self / nomination / both; proof and approval toggles; public timeline and comments; per-user cap, team cap, cooldown, open/close window in local TZ.
- Stickers: 8 (Confetti ∞ people ×1, High Five 3×1, Piñata 6×1, Trophy 1×5, Truck 5×2, Rain 10×1, Rockstars 5×1, Tacocat 1×2); four are locked behind "Unlock Energy".
- Tags: hashtag-based, one tag exists (#productividad), essentially unused.
- Profile: level + title ("Level 21, Taco Apprentice"), given/received/redeemable counters.
- Leaderboard: received/given/combined, timeframe filters, channel filter, Giver Mode.
- Milestones and advanced analytics are Deluxe-only (not active). API enabled with 0 tokens. Danger zone: reset redeemable, reset everything.

### Blockers and unknowns (ranked by risk)

1. ~~**HeyTaco export**~~ RESOLVED 2026-11-24. Exports saved in `data/heytaco/` (git-ignored: contains personal emails):
   - `taco-data(<range>).csv` ×4 (UI caps each download at 1 year): 4,726 rows since 2023-09-17. Columns: receiver/giver name+email, timestamp (America/Bogota), channel, raw Slack message, tacos, tags, type (`message` 2,837 rows/4,660 tacos, `reaction` 1,848/1,848, `sticker` 41/49). 98% of rows are in `#tacos`; 36 receivers historically, 15 active users now.
   - `users.xlsx`: UID, daily limit, totals given/received/bonuses/redeemable/rewards redeemed.
   - `redemption-data(<range>).xlsx` ×4: 203 redemptions, all `individual`; 150 still unfulfilled, 53 fulfilled; reward cost in USD column; titles are soles vouchers.
   - Baseline reconciliation: `received + bonuses − redeemed (joined on Slack user ID) = redeemable` holds for 15/15 users (diff 0). Per-person received/given totals match the People page.
   - Explained: the Activity page's "5,093 all-time tacos given" counts only givers who are current users; the export (6,557) also includes people who left.
2. **Slack event semantics:** retries (idempotency), edited messages, deleted messages, reactions added/removed, private channels, user groups. Spike with recorded fixtures.
3. **Ledger model:** a one-way door; wrong shape poisons migration and every module.
4. **Multi-recipient cost rule:** HeyTaco multiplies cost per recipient and rejects the whole message when over the limit. Decide: same cost rule, but reply with a clear error instead of silently ignoring.

### Rigor level: HIGH

Balances behave like money, the ledger shape is a one-way door, and live cutover replaces a tool the team uses daily. Gates: spec-first, test-first on the domain, an architect/arena pass on the ledger and module boundaries, statecharts for redemptions and quests, a reconciliation script for migration, and an event-replay check before cutover.

## Phase B — Workflow (the playbook)

Ordered riskiest-unknown-first; scaffold and verification before features. Each step ends with a check.

| Step | What | Tool | Check |
|---|---|---|---|
| 0 | Get the HeyTaco export from Pearson admin; inspect its fields | manual + script | Fields map to gifts/balances, or the gap is documented |
| 1 | Write `docs/spec.md`: numbered rules S1..Sn for every area above, with examples | inline | User reviews and approves |
| 2 | Architecture: ledger model, module boundaries, stack (pnpm monorepo, `packages/core` pure TS, adapters) | `/pstack:architect` (runs arena) | DONE 2026-11-25 → `docs/architecture.md` (arena: C3 base + grafts G1–G10) |
| 3 | Statecharts: redemption, collaborative reward, quest submission | `/pstack:statechart` | DONE 2026-11-25 → `docs/statecharts/` (TLC: all rules hold) |
| 4 | Scaffold: monorepo, Vitest, CI, Postgres via Docker, empty Slack app manifest | inline | `pnpm test` green on an empty suite in CI |
| 5 | Verification harness: spec-example test table, Slack event fixture replayer, migration reconciliation script (baseline = HeyTaco export) | inline | Harness runs and reports "0/N rules pass" before features |
| 6 | Core domain + ledger (TDD) | inline | All S# for gifts/ledger green |
| 7 | Persistence + Slack adapter for giving | inline | Fixture replay: every recorded gift lands in the ledger once |
| 8 | Migration importer | inline | Reconciliation diff = 0 on Pearson export |
| 9 | Fan-out (parallel worktrees, disjoint seams): rewards shop · award rules · quests · milestones · gamification · leaderboards/reports | subagents, one per module | Each module's S# green + seam test suite once |
| 10 | REST API + signed webhooks; Pearson Projects integration | inline | One real redemption fulfilled via API |
| 11 | Web app: admin, shop, dashboards (own UI, better than HeyTaco) | `impeccable` / `frontend-design` + visual-proof | Screenshots reviewed by user |
| 12 | Insights + AI digest + pairing chats | inline | Digest generated on Pearson data |
| 13 | Shadow run: app listens to `#tacos` alongside HeyTaco for 1 week | live | Daily diff of balances = 0 |
| 14 | Cutover: uninstall HeyTaco, 2-week live run | live | DoD #3 |
| 15 | Teams adapter, gift cards, OSS packaging, naming | inline | DoD #5 |

## Phase C — Loop discipline

Each step: hypothesis → smallest change → measure against its check → keep or revert. Verdicts are VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Delegated module work is judged by its spec tests, never by the worker's summary.

## Phase D — Audit trail

`decisions.tsv` at the repo root, one row per decision. Committed once the repo exists, since cutover replaces a live tool and the trail is what earns trust.

## Phase E — Hand back

Check the whole against the Definition of done above. Any correction that repeats becomes a test, lint rule, or script.
