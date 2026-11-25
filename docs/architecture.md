# Architecture: "one ledger, one key, one lock"

Status: accepted 2026-11-25 (plan step 2). Grounded in `docs/spec.md` (S1–S108), `docs/plan.md` (D1–D6) and the HeyTaco exports.
Companion files:
- `docs/architecture/core-types.ts`: type sketch.
- `scripts/replay-heytaco.mjs`: runnable proof, `node scripts/replay-heytaco.mjs data/heytaco`.

## How this design was chosen

Three architects designed the system independently, in an arena of three candidates (fable, opus, and the session model). A separate judge scored all three. The judge is Claude-family: no other vendor is configured, so the arena's "different vendor" check could not run. All three candidates reconcile Pearson's data with 0 diffs. Candidate 3 won 26/30 (C1 scored 23, C2 18), and the judge and the parent picked it independently.

**Why candidate 3 won:**
- Nothing derived is stored.
- A gift is one row.
- One `command_log` handles idempotency for every source.
- It is the only proof that handled the 71 redemptions belonging to people who left Pearson.

**What was rejected, and why:**
- **C1/C2 stored balance projections** (`member_balance`, `gift_line`, `redemption_budget.used`). Each is a second copy of the truth that needs a verify job.
- **C2's two rows per gift**, which doubles the table for a giver side that carries no money.
- **C2's pg-boss process**, which is not needed at this scale.
- **C2's claim that receivers are never locked.** It is wrong: `UPDATE … received + n` row-locks the receiver, and that can deadlock.
- **C1's seven idempotency mechanisms**, collapsed here into one.

**Grafts.** These amend the sections below. Where this list and a section disagree, the list wins.

- **G1 (from C1): one effects table.** `EFFECTS: Record<EntryKind, { sign, received, given, redeemable }>` lives in `core/ledger`. It is the single definition used by `replay()`, the SQL aggregates (generated from it) and the reconciliation script. A Postgres `CHECK` per kind enforces the sign.
- **G2 (from C1): claim first, then decide.**
  1. Every write starts with `INSERT INTO command_log (workspace_id, key, request_hash, status) VALUES (…, 'running') ON CONFLICT DO NOTHING RETURNING key`.
  2. On conflict, the transaction waits on the first one's row and returns its stored result. If the `request_hash` differs, it returns 422 `idempotency_key_reused`.
  3. Otherwise it proceeds, and `commit` fills in the result.

  This replaces §1.7's read-then-insert, which turns a concurrent duplicate into a PK abort instead of a replay.
- **G3 (from C1): `packages/app` is split from `packages/core`.**
  - `core` holds only pure deciders `(snapshot, command, now) → Decision | Rejection`, folds, period math, and the port *types*.
  - `app` holds `createApp(ports)`, the use cases (declare locks → claim → load snapshot → decide → commit) and the queries.
  - Adapters depend on `app` and `core` types. `core` depends on nothing.

  §2.2's "use case" examples move to `app`.
- **G4 (from C1): one lock rule for every balance-affecting command.** Reject and cancel also take `member:<m>`, the same as redeem. The order is fixed: aggregate key (`redemption:<id>`, `collab:<id>`, `gift:<msgKey>`) → `budget:<ws>:<yyyy-mm>` → `member:<id>` ascending.
- **G5 (from C1 + C2): a Postgres concurrency acceptance suite** in `packages/db`, run with `Promise.all` against real Postgres. Each case must hold:
  - 20 parallel gifts from one giver with allowance 5 → exactly 5 units given;
  - 10 parallel redemptions with redeemable for 3 → exactly 3 succeed;
  - A→B and B→A at once → both succeed, no deadlock;
  - reject vs fulfil on the same redemption → one wins, at most one refund;
  - the same Slack event twice at once → one ledger write, both callers get the same result;
  - bulk reset during a redemption → serialized.
- **G6 (from C1): importer `--until <timestamp>` cutoff.** During the shadow run (plan step 13), imported history stops where live capture starts, so no gift is counted twice.
- **G7 (decision): Slack acknowledgement order.** `apps/server` runs `execute` *before* acking, because one short transaction fits Slack's 3 s budget. If execute fails or times out, Slack retries and `command_log` dedupes. An ack is never sent for an event that was not durably handled, so DoD #3 (zero lost gifts) holds without C1's extra `inbound_event` table. If p99 ever approaches 3 s, the fallback is C1's insert-before-ack inbox.
- **G8 (decision): reaction re-add after removal.** A2 says a duplicate reaction counts once. But a person who removes a reaction (S21 reversal) and adds it again is expressing intent again. So the reaction key carries an occurrence counter: `slack:react:<team>:<channel>:<ts>:<user>:<emoji>:<n>`, where `n` = the number of prior same-day reversals for that (giver, message, emoji). Slack retries of the same add still collide (same `n`). This is reversible: set `n` to always 0 to get the strict reading.
- **G9 (from C3, kept): reconciliation checks completeness, not only totals.** `rows read = rows imported` for activity and redemptions, plus 0 diffs on received, given and redeemable for current users. A 15-user total alone misses lost redemptions of departed people.
- **G10 (from C2): integer money.** Money is integer cents plus an ISO currency (S44, S47). Ids are UUIDv7. `ledger_entry.seq` is `bigint identity` for replay order.

## 0. The design in five sentences

1. Every balance change is one row in one append-only table, `ledger_entry`, whose `kind` fixes the sign; `redeemable` is the plain sum of a member's rows, and `received`, `given` and today's allowance are filtered sums of the same rows.
2. Nothing derived is stored: balances, allowance, levels and leaderboards are SQL aggregates over the ledger, so there is no projection to drift (S34, S78).
3. Every write is a command with a deterministic **command key**; the key is the primary key of `command_log`, which stores the result, so retries (Slack, API, scheduler, importer) return the original result and never write twice (S17, S62, S100, S105).
4. A command that checks a balance takes a Postgres advisory lock on the member it debits, re-reads the sums, and commits entries, state changes and outbox events in one transaction (S50, S51).
5. The domain (`packages/core`) is pure TypeScript with ports; Slack, REST, Next.js, Prisma, the worker and the HeyTaco importer are adapters that translate into `core.execute(command)` and never hold business rules (S106).

Proof: `node replay.mjs` imports all of Pearson's export into this model and reconciles **15/15 members with 0 diffs** on received, given and redeemable, and a second import appends **0** entries (section 9).

---

## 1. Ledger model

### 1.1 Entry kinds

One row per (member, effect). The closed set:

| kind | sign | member | counterpart | cause | allowance_day | spec |
|---|---|---|---|---|---|---|
| `gift` | + | receiver | giver | gift id, or import | local day consumed, or null | S9–S12, S18, S23, S74, S76a |
| `gift_reversal` | − | receiver | giver | gift id | day restored, or null | S21, S23, S24, S38 |
| `bonus` | + | member | — | admin, milestone, import | null | S36, S94 |
| `rule_award` | + | member | — | rule id + period | null | S63 |
| `quest_reward` | + | member | — | submission id | null | S67 |
| `spend` | − | member | — | redemption or collab contribution | null | S50, S56 |
| `refund` | + | member | — | redemption or collab contribution | null | S51, S58 |
| `deduction` | − | member | — | admin (incl. bulk reset) | null | S37, S39 |

Columns (S30): `seq bigserial`, `workspace_id`, `command_key`, `ordinal`, `kind`, `amount int` (signed, `CHECK (sign(amount) = expected sign of kind)` and `amount <> 0`), `member_id`, `counterpart_id`, `cause_type`, `cause_id`, `source` (message/reaction/sticker, gifts only), `allowance_day date`, `at timestamptz`, `reason text`. `UNIQUE (workspace_id, command_key, ordinal)`.

Why a gift is **one** row and not a debit/credit pair: the giver's side of a gift is not a balance. The giver loses no redeemable units; they consume allowance, which is a daily counter, and accumulate `given`, which is a statistic. Both read the same row through `counterpart_id`. A pair of rows would double the table and add a "giver leg" that carries no money (see rationale).

Why `amount` is signed in the DB but a magnitude in TypeScript: S30 asks for a signed amount, and signed rows let SQL sum without a CASE. In code the sign is implied by `kind` (`SIGN` in `core-types.ts`), so a negative gift cannot be constructed. The CHECK constraint keeps both views equal.

### 1.2 Derivations

Every formula reads only `ledger_entry` (plus `member` config for the daily limit):

```sql
-- S31 received  /  S33 given
received(m)   = SUM(amount) WHERE member_id = m      AND kind IN ('gift','gift_reversal')
given(m)      = SUM(amount) WHERE counterpart_id = m AND kind IN ('gift','gift_reversal')
-- S32 redeemable: every kind moves redeemable, so it is the plain sum
redeemable(m) = SUM(amount) WHERE member_id = m
-- S19, S21, S27 allowance (a reversal with allowance_day = today gives units back)
used(m, d)    = SUM(amount) WHERE counterpart_id = m AND allowance_day = d
allowance(m)  = daily_limit(m) - used(m, today_in_workspace_tz)
daily_limit(m)= member.daily_limit_override ?? (role = admin ? ws.admin_default : ws.default)   -- S25, S26
```

- S27 needs no reset job: tomorrow is a different `allowance_day`, so `used` is 0.
- S38 admin reversal writes `allowance_day = null`, so it never restores allowance.
- S21/S24 reversals are written only when the action happens on the gift's own allowance day; after that day the command is a no-op that still logs its result.
- S74 sticker gifts have `allowance_day = null`; they count to received but not to allowance.
- S4: entries store the computed integer amount, so currency changes never touch history.
- S35: only `spend` is guarded (`redeemable − cost ≥ 0` under the member lock). `deduction` and `gift_reversal` are not guarded, so they are the only kinds that can drive redeemable negative.

The same derivations exist as one pure function, `replay(entries)` in core, used by tests, by `replay.mjs`, and by the nightly `ledger-check` job that compares it with the SQL aggregates. A difference is a bug (S34).

### 1.3 No stored projections

Balances are computed on read with indexed sums:

- `ledger_entry (workspace_id, member_id)` — redeemable, received.
- `ledger_entry (workspace_id, counterpart_id, allowance_day)` — allowance, given.
- `ledger_entry (workspace_id, at)` — leaderboards and reports by time range.

Scale check: Pearson produced 4,929 entries in 3.2 years. A member's sum touches a few hundred rows. A workspace 100× Pearson's size still sums thousands of rows per member, which an index scan does in well under a millisecond. Leaderboards are `GROUP BY member_id` over a time range, which is also the only shape that supports arbitrary ranges, channel filters and value filters (S80, S82) — a stored "balance" column could not answer them anyway.

If a workspace ever outgrows this, the escape hatch is additive and keeps the invariant: a `balance_checkpoint (member_id, upto_seq, received, given, redeemable)` written by a job, with live reads = checkpoint + sum of entries after `upto_seq`. It is not built now.

### 1.4 Non-ledger state and who owns it

Each piece of state has exactly one owner table. Only the ledger is append-only by contract; the rest are ordinary rows changed by compare-and-set.

| State | Table | Mutability |
|---|---|---|
| Money movements | `ledger_entry` | append-only, UPDATE/DELETE rejected by trigger |
| Command results, actor, audit | `command_log` | append-only |
| Outbox events | `domain_event` | append-only; delivery state lives in `delivery` |
| Gift header (giver, channel, text, privacy, sticker) | `gift` | text rewritten on edit (S23) |
| Gift value tags | `gift_value` | insert-only (S42) |
| Redemption state | `redemption` | CAS on `state` (S49) |
| Stock | `reward` / `reward_variant.stock` | conditional decrement (S46, S50) |
| Collab progress | derived from `spend`/`refund` entries with `cause = contribution` | — |
| Quest submission state | `quest_submission` | CAS on `state` |
| Sticker grants (S76) | `sticker_grant` | insert-only; quota used = count of sticker gifts in month |

### 1.5 Redemption: debit and refund are one transaction

`Redeem` (S50, S52):

```
BEGIN (READ COMMITTED)
  pg_advisory_xact_lock(member:<m>)            -- plus budget:<ws>:<yyyy-mm> if a budget exists (S47)
  SELECT result FROM command_log WHERE key=$k  -- replay → return stored result
  redeemable := SUM(amount) WHERE member_id = m
  reward must be 'active' (S45)
  if redeemable < cost        → log rejection, COMMIT
  if budget and spent+cost > budget → log rejection, COMMIT
  UPDATE reward_variant SET stock = stock - 1 WHERE id=$v AND (stock IS NULL OR stock > 0)  -- 0 rows → out_of_stock
  INSERT redemption (state = auto_approve ? 'approved' : 'pending')
  INSERT ledger_entry (kind='spend', amount=-cost, cause=redemption)
  INSERT domain_event redemption.created (+ redemption.approved when auto)
  INSERT command_log (key, request_hash, actor, result)
COMMIT
```

`TransitionRedemption` reject/cancel (S51):

```
BEGIN
  SELECT result FROM command_log WHERE key=$k
  UPDATE redemption SET state='rejected', ... WHERE id=$r AND state='pending'   -- CAS; 0 rows → illegal_transition or idempotent no-op
  INSERT ledger_entry (kind='refund', amount=+cost, command_key=$k)
  UPDATE reward_variant SET stock = stock + 1 WHERE id=$v AND stock IS NOT NULL
  INSERT domain_event redemption.rejected
  INSERT command_log
COMMIT
```

The refund needs no member lock: it only credits. A double refund is impossible twice over: the CAS lets only one transaction leave `pending`, and the refund's `(command_key, ordinal)` is unique.

`fulfil` on an already-fulfilled redemption returns `ok` without writing (S53): the use case reads the state, sees `fulfilled`, and logs a no-op result under the new key.

Collaborative rewards (S56–S59) reuse the same kinds: a contribution is `spend` with `cause = contribution:<collab>` under locks `member:<m>` then `collab:<c>` (fixed order), capped at `goal − progress` (S59). Reaching the goal inserts one redemption with `onBehalfOf = collab` and no extra debit (S57). Archive or deadline writes one `refund` per contributor in one transaction (S58); if the collab's redemption is later rejected, the same refund fan-out runs.

### 1.6 Concurrency

Isolation is READ COMMITTED everywhere; correctness comes from three tools, each used for one job:

| Tool | Protects | Used by |
|---|---|---|
| `pg_advisory_xact_lock(hashtextextended(key, 0))` on sorted keys | invariants that read a sum before writing (allowance, redeemable ≥ cost, budget, collab goal) | gift, reaction, edit top-up, sticker, redeem, contribute, bulk reset |
| Compare-and-set `UPDATE … WHERE state = $from` / `stock > 0` | single-row state machines and counters | redemption, quest submission, stock |
| Unique constraints (`command_log.key`, `ledger_entry (command_key, ordinal)`) | duplicates from retries and races between replicas | every write |

Walkthroughs:

- **Two gifts by the same giver at the same instant** (e.g. a message gift and a reaction): both lock `member:<giver>`; the second waits, then reads `used(today)` including the first and is refused if over allowance (S13). Receivers are never locked: crediting needs no check.
- **Two redemptions by the same member at the same instant**: both lock `member:<m>`; the second sees the first `spend` and fails `insufficient_redeemable`. No negative balance is reachable through `spend` (S35).
- **The same Slack event delivered twice, concurrently, to two server replicas**: both lock the giver; the second finds the key in `command_log` and returns the stored result. If both somehow passed the check (they cannot, under the lock), the `command_log` primary key would abort the second transaction.
- **Last unit of stock**: the conditional decrement serializes on the row lock Postgres takes for UPDATE; the loser gets 0 rows and rolls back.
- **Bulk reset vs a redemption** (S39): reset locks every member key in sorted order, then writes one `deduction` of exactly `redeemable(m)` per member with a positive balance. A concurrent redemption either commits first (reset sees it) or waits.
- **Deadlocks**: keys are acquired in one `pg_advisory_xact_lock` loop over a sorted list, so lock order is global. A use case declares its keys up front (`uow.run(ws, keys, fn)`); it cannot lock lazily.

Why advisory locks instead of `SELECT … FOR UPDATE` on `member`: the budget and prepaid checks have no natural row to lock, and locking `member` would block profile edits. Why not SERIALIZABLE: it would require retry loops around every Slack handler and still need the same reasoning to be correct under retry; the lock makes the critical section explicit and testable with an in-memory mutex fake.

### 1.7 Idempotency: one mechanism

`command_log (workspace_id, key PRIMARY KEY, request_hash, actor jsonb, result jsonb, at)`.

Every command carries a deterministic `CommandKey` built by the adapter that received it. The use case reads `command_log` first under its locks; a hit returns the stored result with `replayed: true`. A miss runs `decide`, and the commit inserts the log row in the same transaction as the entries and events.

| Source | Key | Spec |
|---|---|---|
| Slack message | `slack:msg:<team>:<channel>:<ts>` | S17 |
| Slack edit | `slack:edit:<team>:<channel>:<ts>:<edit_ts>` | S17, S23 |
| Slack delete | `slack:del:<team>:<channel>:<ts>` | S24 |
| Slack reaction | `slack:react:<team>:<channel>:<ts>:<user>:<emoji>` | S20 — the key is the business rule: one reaction gift per giver, message and emoji, ever |
| REST write | `api:<token_id>:<Idempotency-Key header>`; `request_hash` mismatch → 422 `idempotency_key_reused` | S100 |
| Rule evaluation | `rule:<rule_id>:<period>` | S62 |
| Periodic job | `job:<name>:<workspace>:<period>` (weekly report, nudge, pairing round, milestone day) | S84, S86, S93, S95 |
| Import | `import:heytaco:<gift|redemption|bonus>:<sha256(row fields)>:<occurrence>` | S105 |
| Internal follow-up | `redemption:<id>:<transition>`, `collab:<id>:refund` | S51, S58 |

Consequences:

- Rejections are logged too, so a retried over-allowance message does not DM the giver twice (S13).
- Exactly-once side effects: notifications and webhooks are `domain_event` rows written by the same transaction, so a replay emits nothing new.
- `command_log` with its `actor` is the audit log (S40, S98): every admin adjustment is a command whose actor, time, reason and resulting entries are joined by `command_key`.
- Import occurrence numbers keep genuinely repeated rows: HeyTaco counted them, and parity (S103) requires the same count. In the current export there are none, but the key handles them.
- A reaction removed and re-added never re-gifts (S20 taken literally). This is documented user-facing behavior.

### 1.8 Append-only enforcement

- Migration adds `CREATE TRIGGER ledger_no_mutation BEFORE UPDATE OR DELETE ON ledger_entry … RAISE EXCEPTION`, the same for `command_log` and `domain_event`.
- The app role gets `INSERT, SELECT` only on those tables.
- Workspace deletion (S72) is a separate privileged command run by an owner role, after an explicit confirmation; it is the only path that removes ledger rows, and it removes the whole workspace.

---

## 2. Module boundaries

### 2.1 Layers and the dependency rule

```
apps/web  apps/server  apps/cli          ← processes (composition roots)
   │          │           │
   ├── packages/slack ────┤               ← platform translation (Bolt), Block Kit rendering
   ├── packages/heytaco ──┤               ← export parsers (CSV/XLSX) → ImportHeyTacoRow commands
   ├── packages/db ───────┘               ← Prisma schema + migrations, implements app ports
   ▼
packages/app                               ← use cases: locks → claim → load → decide → commit; queries (G3)
   ▼
packages/core                              ← pure domain: deciders, EFFECTS, folds, period math, port types
```

`core` imports nothing outside the TypeScript standard library (time zones through `Intl`). Adapters import `core`; `core` imports no adapter. Enforced by `dependency-cruiser` in CI.

### 2.2 The pure domain (`packages/core`)

Screaming structure: one folder per business capability. Each folder has pure `decide` functions and a use case that wires them to ports.

```
packages/core/src/
  workspace/     settings, currency, timezone & period math            S1–S4
  members/       roles, activation, identities, bots                   S5–S8, S107
  giving/        quote, message/reaction/edit/delete, allowance       S9–S29, S69, S70
  ledger/        entry kinds, SIGN, replay, adjustments               S30–S40
  values/        tag matching, tag-by-reaction                         S41–S43
  shop/          catalog, stock, budget, redemptions, collab, giftcards S44–S59, S108
  rules/         criteria, period close, tie handling                  S60–S63
  quests/        lifecycle, submissions, caps, cooldowns, auto-trigger S64–S68
  stickers/      definitions, monthly quota, grants                    S73–S76a
  levels/        threshold table, avatars                              S77–S79
  boards/        leaderboard & report query specs                      S80–S88
  insights/      isolation, reciprocity, digest input selection        S88–S91
  milestones/    birthdays, anniversaries, celebration plan            S92–S94
  pairing/       pairing algorithm                                     S95–S96
  notify/        event → notification plan, preferences               S29, S54, S83, S85
  migration/     HeyTaco row → command mapping, reconciliation         S101–S105
  api/           scopes, idempotency policy (framework-free)           S97–S100
  index.ts       createCore(ports): { execute, queries… }
```

**Shape of every write**, in two steps:

```ts
// pure: (snapshot, command, now) → Decision  — unit-tested exhaustively, no fakes needed
decideRedeem(snapshot: { redeemable; reward; budgetLeft; settings }, cmd, now): Decision<RedemptionId>

// use case: declares locks, loads the snapshot through Tx, calls decide, commits
async function redeem(p: Ports, cmd) {
  return p.uow.run(cmd.workspaceId, [`member:${cmd.memberId}`, ...budgetKey], async (tx) => {
    const prior = await tx.priorResult(cmd.key); if (prior) return replayed(prior);
    const d = decideRedeem(await loadSnapshot(tx, cmd), cmd, p.clock.now());
    await tx.commit(cmd.key, hash(cmd), cmd.actor, d);
    return d.result;
  });
}
```

**Public API** (full types in `core-types.ts`):

- `createCore(ports): Core`
- `core.execute(command): Promise<Result<T>>` — the only write entrypoint. Commands: `GiveByMessage`, `GiveByReaction`, `RemoveReaction`, `EditMessage`, `DeleteMessage`, `GiveSticker`, `GrantBonus`, `Deduct`, `ReverseGift`, `ResetAllRedeemable`, `Redeem`, `TransitionRedemption`, `Contribute`, `EvaluateRule`, `SubmitQuest`, `ReviewSubmission`, `ImportHeyTacoRow`, plus configuration commands (settings, rewards CRUD, values, quests, stickers, members) that follow the same pattern without ledger entries.
- Queries: `balances`, `leaderboard`, `report`, `insights`, `exportAll`, `pairingPlan`, `celebrationsDue`, `rulesDue`. Queries take a read-only `Reader` port; they never lock.
- Events: the `DomainEvent` union. Core emits them as data in `Decision.events`; it never sends anything.
- Ports: `UnitOfWork`/`Tx`, `Reader`, `Clock`, `Ids`, `Directory`, `GiftCardProvider`, `Summarizer`.

**Testing**: `packages/core/test/fakes` implements every port in memory (a `Map` of entries, a mutex map for locks). The spec harness (plan step 5) is a table `S# → test` that runs through `createCore(fakes)`; the same suite runs against `packages/db` with a real Postgres (Testcontainers or the compose Postgres) as the port contract test.

### 2.3 Adapters

| Adapter | Package / app | Responsibility | Holds business rules? |
|---|---|---|---|
| Postgres | `packages/db` | Prisma schema, SQL migrations (triggers, CHECKs, partial indexes), `UnitOfWork`/`Tx`/`Reader`/`Directory` implementations, aggregate SQL via TypedSQL | No |
| Slack | `packages/slack` + `apps/server` | Bolt app (HTTP or Socket Mode); events → normalized `InboundMessage` + `CommandKey`; expands `@group` to member ids (S12) without deciding; renders Block Kit for DMs, App Home, shop modal (S28, S48); resolves identities (S107); install/uninstall (S5, S72) | No |
| Outbox relay | `apps/server` | Reads `domain_event` with `FOR UPDATE SKIP LOCKED`, fans out to `delivery` rows (webhook endpoints, member DMs, channel posts); retries with backoff; woken by `LISTEN/NOTIFY` with a 1 s poll fallback | No — who-gets-what comes from `core/notify` |
| Scheduler | `apps/server` | Every minute, asks core which periodic commands are due per workspace (`rulesDue`, reports, nudges, milestones, pairing, isolation alerts, collab deadlines) and executes them with `rule:`/`job:` keys | No — "is it due" is core period math |
| Webhooks | `apps/server` | HMAC-SHA256 signature `t=<unix>,v1=<hex>` over `t + "." + body`, per-endpoint secret, `event_id` = `domain_event.id`, exponential backoff (1 m → 12 h, 12 attempts), then `dead` (S99) | No |
| REST API | `apps/web` route handlers `/api/v1/*` | Bearer token → `Actor{apiToken, scopes}`; `Idempotency-Key` → `api:` command key; maps HTTP to `core.execute`/queries (S97–S100) | No |
| Web UI | `apps/web` (Next.js App Router, shadcn/ui, TanStack Query) | Admin, shop, dashboards, TV mode (S87), CSV export (S71). Server actions call `core` directly with a `member` actor from Slack OAuth sign-in | No |
| AI digest | `apps/server` | `Summarizer` port via Vercel AI SDK + OpenRouter (S91) | No — core selects the input gifts and links |
| Gift cards | `apps/server` | `GiftCardProvider` port (S108), optional | No |
| Importer | `packages/heytaco` + `apps/cli` | Parses the CSVs and XLSX files, matches members (UID, else email, S102), emits `ImportHeyTacoRow` commands, then runs reconciliation and prints diff counts (S103) | No — mapping lives in `core/migration` |

Teams later is a new `packages/teams` producing the same `InboundMessage` (S106); nothing in core changes.

### 2.4 Process topology

Two long-running processes from one Docker image, plus Postgres:

- `web` — `next start`: UI + REST API.
- `server` — Bolt receiver + outbox relay + scheduler, in one Node process. Slack needs a fast ack; Bolt acks before `core.execute` runs, and the relay/scheduler work is light at this scale. Running two `server` replicas is safe: locks, SKIP LOCKED and command keys make every job idempotent.
- `migrate` — one-shot `prisma migrate deploy` before the others start.
- `cli` — `docker compose run --rm cli import ./export`, `reconcile`, `ledger-check`, `export`.

---

## 3. S# coverage map

Every rule is owned by exactly one core module (where its behavior test lives); "adapter" lists the delivery side where it matters.

| S# | Rule (short) | Core module | Adapter part |
|---|---|---|---|
| S1 | currency names/emoji | workspace | slack/web render via names |
| S2 | extra emojis with values | workspace, giving.quote | — |
| S3 | workspace timezone | workspace (period math) | — |
| S4 | currency changes not retroactive | ledger (stored amounts) | — |
| S5 | admin/member roles, installer admin | members | slack install |
| S6 | approver role | members, shop, quests | — |
| S7 | deactivation | members, boards | — |
| S8 | bots never receive; may give by setting | members, giving | slack flags bots |
| S9 | gift message definition | giving.quote | slack normalizes |
| S10 | multi-receiver cost | giving.quote | — |
| S11 | giver excluded | giving.quote | — |
| S12 | group mentions setting | giving.quote | slack expands groups |
| S13 | over-limit notice | giving | relay DM |
| S14 | message text as reason | giving | — |
| S15 | hashtags → values | values | — |
| S16 | DMs/private channels | giving | slack channel kind |
| S17 | event idempotency | ledger/command_log policy | slack builds keys; db PK |
| S18 | reaction gifts | giving | slack reaction events |
| S19 | reaction consumes allowance | giving (allowance_day) | — |
| S20 | one reaction gift per (giver,msg,emoji) | giving (key) | slack key format |
| S21 | reaction removal same day | giving | — |
| S22 | no self reaction gift | giving.quote | — |
| S23 | edit recompute | giving | slack message_changed |
| S24 | delete same day | giving | slack message_deleted |
| S25 | daily allowance + overrides | giving.allowance | db Directory |
| S26 | admin default allowance | giving.allowance | — |
| S27 | reset at local midnight | giving.allowance (allowance_day) | — |
| S28 | see remaining allowance | giving (query) | slack command + App Home |
| S29 | confirmation with remaining | notify | relay DM |
| S30 | append-only entries | ledger | db trigger + grants |
| S31 | received | ledger.replay | db SQL |
| S32 | redeemable | ledger.replay | db SQL |
| S33 | given | ledger.replay | db SQL |
| S34 | rebuild by replay | ledger.replay | cli ledger-check |
| S35 | no negative via redemption | shop | db lock |
| S36 | bonus | ledger.adjustments | web/api |
| S37 | deduction | ledger.adjustments | web/api |
| S38 | gift reversal (no allowance) | ledger.adjustments | web/api |
| S39 | bulk reset | ledger.adjustments | web |
| S40 | audit log | ledger (command_log actor) | web audit page |
| S41 | values definition | values | web |
| S42 | tag by hashtag/emoji/reaction | values | slack reactions |
| S43 | values report | boards | web |
| S44 | reward fields | shop.catalog | web |
| S45 | reward lifecycle | shop.catalog | — |
| S46 | stock | shop | db conditional update |
| S47 | monthly budget | shop | db budget lock |
| S48 | redeem in chat | shop | slack App Home/modal |
| S49 | redemption states | shop.redemptions | — |
| S50 | debit + reserve on create | shop.redemptions | db tx |
| S51 | atomic refund | shop.redemptions | db tx |
| S52 | auto-approval | shop.redemptions | — |
| S53 | fulfil idempotent, API | shop.redemptions | api |
| S54 | events + member DM | shop, notify | relay |
| S55 | manual redemption | shop.redemptions | web |
| S56 | collab contributions | shop.collab | slack/web |
| S57 | goal → one redemption | shop.collab | relay notifies |
| S58 | refund on archive/deadline | shop.collab | scheduler (deadline) |
| S59 | cap overshoot | shop.collab | — |
| S60 | rule definition | rules | web |
| S61 | evaluate after close, announce | rules | scheduler, relay |
| S62 | idempotent per period | rules (key) | db PK |
| S63 | awards to redeemable only | rules, ledger | — |
| S64 | quest fields | quests | web |
| S65 | quest lifecycle | quests | — |
| S66 | submission states | quests | slack/web |
| S67 | quest rewards redeemable only | quests, ledger | — |
| S68 | event-triggered completion | quests (reacts to DomainEvent) | relay invokes core |
| S69 | private gifts hidden | boards, giving | web/slack feeds |
| S70 | no message text | giving | — |
| S71 | full CSV export | boards (exportAll) | web/cli |
| S72 | uninstall keeps data | members | slack uninstall; db owner command |
| S73 | sticker definitions | stickers | web |
| S74 | stickers skip allowance, count received | stickers, ledger | — |
| S75 | monthly sticker quota | stickers | — |
| S76 | extra sticker uses | stickers | web |
| S76a | import stickers as gifts | migration | heytaco |
| S77 | levels from received+given | levels | — |
| S78 | levels not stored | levels | — |
| S79 | avatars unlock by level | levels | web |
| S80 | leaderboards, timeframes, filters | boards | db SQL |
| S81 | giver mode | boards | — |
| S82 | value filter | boards | db SQL |
| S83 | receiver notification | notify | relay DM |
| S84 | weekly report | boards (report), notify | scheduler |
| S85 | per-type notification prefs | notify | slack/web settings |
| S86 | weekly nudge | notify, giving.allowance | scheduler |
| S87 | TV display | boards | web |
| S88 | admin metrics | insights | web |
| S89 | isolation alert | insights | scheduler |
| S90 | reciprocity flags | insights | scheduler/web |
| S91 | AI monthly digest | insights | server Summarizer |
| S92 | birthday/start date | milestones | web/slack |
| S93 | celebration post at local time | milestones | scheduler |
| S94 | milestone bonus | milestones, ledger | scheduler |
| S95 | pairing schedule & groups of 3 | pairing | scheduler, slack group DM |
| S96 | prefer least-exchanged, avoid repeats | pairing | — |
| S97 | REST resources | api | web route handlers |
| S98 | scoped revocable tokens | api, members | web |
| S99 | signed webhooks | api (event catalog) | relay |
| S100 | API idempotency keys | api (key policy) | db command_log |
| S101 | importer reads exports | migration | heytaco parsers |
| S102 | match by UID else email | migration | heytaco |
| S103 | reconciliation diff 0 | migration | cli reconcile |
| S104 | fulfilled flag mapping | migration | — |
| S105 | idempotent import | migration (keys) | db PK |
| S106 | adapters hold no rules | (architecture; dependency-cruiser) | all |
| S107 | multi-platform identity | members | db `identity` table |
| S108 | gift cards | shop | server GiftCardProvider |

No S# is orphaned: 109 rows (S1–S108 plus S76a).

---

## 4. Giving flow in detail (the hottest path)

`GiveByMessage` from Slack:

1. Bolt receives `message`; acks immediately.
2. `packages/slack` normalizes: `<@U…>` → `Mention.member` via the identity table; `<!subteam^S…>` → `Mention.group` with members fetched from `usergroups.users.list` (cached 5 min); bots → `Mention.bot`; emoji shortcodes in order; hashtags; channel kind. Key `slack:msg:<team>:<channel>:<ts>`.
3. `core.execute` → `giving.give`:
   - `uow.run(ws, ['member:<giver>'], …)`
   - `priorResult(key)` → replay if present.
   - `quoteGift` (pure): recognized emoji sum (S2, S9), receivers = members + expanded groups (if S12 on) − giver − inactive − bots, deduped (S10, S11, S22). Not a gift → log `not_a_gift`, no event.
   - Channel policy (S16). Allowance: `limit − used(today)`; cost > remaining → log rejection + `gift.rejected` event (S13).
   - Decision: `gift` header (text unless S70), N `gift` entries with `allowance_day = today`, `gift_value` rows (S15), `gift.given` event carrying `remainingAllowance` (S29).
4. Relay turns `gift.given` into the giver confirmation (S29), one DM per receiver (S83, subject to S85), a webhook delivery (S99), and quest auto-trigger evaluation (S68).

Edits (S23): `EditMessage` loads `netGiftedPerReceiver(gift)`, re-quotes the new text, and writes the per-receiver differences: increases are `gift` entries on today's allowance (refused as a whole if over allowance), decreases are `gift_reversal` entries that restore allowance only if today is the original `allowance_day`. A message with no gift yet that now qualifies is treated as a new gift at edit time.

Reactions (S18–S22): receivers = mentions of the target message, else its author; emoji must be a gift emoji, otherwise if it is a value emoji it tags the gift (S42). Value emojis and gift emojis are validated disjoint at configuration time, so an emoji means one thing.

---

## 5. Scheduled work

One loop in `apps/server`, ticking each minute. For each workspace it asks core what is due given `now` and the workspace timezone, then executes it as a normal command with a `rule:`/`job:` key. Exactly-once comes from the key, not from the scheduler, so a missed tick, a restart or two replicas never double-pay or double-post.

| Job | Due when | Key | Spec |
|---|---|---|---|
| Rule evaluation | period closed in ws tz | `rule:<id>:<period>` | S60–S63 |
| Weekly report | configured weekday/time | `job:report:<ws>:<week>` | S84 |
| Nudge | Friday (configurable) | `job:nudge:<ws>:<week>` | S86 |
| Celebrations | configured local time on the day | `job:celebrate:<ws>:<date>` | S93, S94 |
| Pairing round | weekly/biweekly/monthly | `job:pairing:<ws>:<round>` | S95, S96 |
| Isolation alert | weekly | `job:isolation:<ws>:<week>` | S89 |
| Reciprocity scan | per period | `job:reciprocity:<ws>:<period>` | S90 |
| AI digest | monthly | `job:digest:<ws>:<month>` | S91 |
| Collab deadline | deadline passed | `collab:<id>:refund` | S58 |
| Ledger check | nightly | `job:ledger-check:<ws>:<date>` | S34 |

Why no job-queue library (pg-boss, BullMQ): the only queue-like needs are "retry a delivery" and "run X once per period". Both are already solved by `delivery.next_attempt_at` and command keys. A queue would add a second source of truth for "did this run". If delivery volume ever needs it, pg-boss is the drop-in (Postgres-only, no Redis).

---

## 6. Webhooks and notifications (outbox)

- `domain_event (id uuidv7, workspace_id, command_key, type, payload jsonb, at)` — written in the business transaction.
- `delivery (id, event_id, destination, status pending|done|dead, attempts, next_attempt_at, last_error)` — created by the relay when it first reads the event (`destination` = webhook endpoint, member DM or channel post), `UNIQUE (event_id, destination)`.
- Relay: `SELECT … FROM delivery WHERE status='pending' AND next_attempt_at <= now() FOR UPDATE SKIP LOCKED LIMIT 50`.
- Webhook payload: `{ id: event.id, type, created_at, workspace_id, data }`; headers `X-Recog-Event-Id`, `X-Recog-Signature: t=…,v1=…`. Receivers dedupe on `id` (S99).
- At-least-once to the outside, exactly-once into the outbox. A receiver that marks a redemption fulfilled via the API with the same idempotency key twice gets the same answer (S53, S100).

---

## 7. Stack decisions

| Concern | Choice | Notes |
|---|---|---|
| Language/runtime | TypeScript, Node 24 LTS | baseline |
| Monorepo | pnpm workspaces + Turborepo task cache | Turborepo only caches; drop it if unwanted |
| Tests | Vitest; spec table harness; Postgres contract tests | baseline |
| DB | Postgres 17 | advisory locks, SKIP LOCKED, LISTEN/NOTIFY |
| ORM | **Prisma, kept** | see below |
| Web | Next.js App Router, React 19, shadcn/ui, TanStack Query | baseline |
| Slack | `@slack/bolt` (HTTP receiver; Socket Mode by env flag) | Socket Mode lets self-hosters skip a public Slack URL |
| Jobs | in-process scheduler + outbox relay, no queue lib | section 5 |
| AI | Vercel AI SDK + OpenRouter | baseline |
| XLSX parsing (importer) | `exceljs` in `packages/heytaco` | CLI only; never in core |
| Boundary lint | dependency-cruiser | enforces S106 |

**Prisma and an append-only ledger with locks.** Prisma fits, with three conscious uses of its escape hatches:

1. Interactive transactions (`prisma.$transaction(async tx => …, { isolationLevel: 'ReadCommitted', timeout })`) give one connection per unit of work; advisory locks are `tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtextextended(${k}, 0))\`` in sorted order.
2. Aggregates (balances, allowance, leaderboards) are TypedSQL files (`prisma/sql/*.sql`) so they are typed and reviewed as SQL. `prisma.ledgerEntry.aggregate` also works for the simple sums.
3. Triggers, CHECK constraints, partial indexes and grants live in hand-written SQL inside Prisma migrations, which Prisma supports.

Everything else (config CRUD, rewards, quests, members) is plain Prisma. Alternatives (Kysely, Drizzle, raw `pg`) would make the ledger SQL marginally nicer but split the stack the team already uses; the ledger code is ~10 queries behind the `Tx` port, so the choice is reversible.

**Deploy (self-host)**: `docker compose up` with services `postgres`, `migrate` (one-shot), `web`, `server`. One image, `CMD` differs. Required env: `DATABASE_URL`, `SLACK_*`, `APP_URL`, `ENCRYPTION_KEY` (webhook secrets and Slack tokens encrypted at rest), optional `OPENROUTER_API_KEY`. A `slack-manifest.yaml` at the root declares scopes, events (`message.channels`, `message.groups`, `reaction_added`, `reaction_removed`, `app_home_opened`, `app_uninstalled`) and interactivity.

---

## 8. Repo layout

```
.
├── apps/
│   ├── web/                     Next.js: (admin)/ (shop)/ (dashboards)/ tv/ api/v1/
│   ├── server/                  bolt.ts  relay.ts  scheduler.ts  summarizer.ts  giftcards.ts  main.ts
│   └── cli/                     import.ts  reconcile.ts  ledger-check.ts  export.ts
├── packages/
│   ├── core/
│   │   ├── src/<module>/        decide.ts  types.ts  (modules from §2.2; pure, no I/O)
│   │   ├── src/ledger/effects.ts EFFECTS table (G1)
│   │   ├── src/ports.ts         port types only: UnitOfWork, Tx, Reader, Clock, Ids, Directory, …
│   │   └── test/spec/           S001.test.ts … deciders with literal snapshots
│   ├── app/
│   │   ├── src/<module>/usecase.ts  locks → claim → load → decide → commit (G2, G3, G4)
│   │   ├── src/index.ts         createApp(ports): { execute, queries… }
│   │   └── test/                fakes/ (in-memory ports, mutex locks) + use-case tests
│   ├── db/
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/migrations/   incl. ledger triggers, CHECKs, grants
│   │   ├── prisma/sql/          TypedSQL aggregates
│   │   ├── src/                 uow.ts  tx.ts  reader.ts  directory.ts
│   │   └── test/concurrency/    G5 acceptance suite against real Postgres
│   ├── slack/                   normalize.ts  keys.ts  blocks/  identity.ts
│   └── heytaco/                 csv.ts  xlsx.ts  match.ts → ImportHeyTacoRow[]
├── docker-compose.yml
├── Dockerfile
├── slack-manifest.yaml
├── scripts/replay-heytaco.mjs   migration baseline proof (plan step 5 harness seed)
├── decisions.tsv
└── docs/  spec.md  plan.md  architecture.md  architecture/core-types.ts
```

---

## 9. Runnable proof: `replay.mjs`

`node replay.mjs [data/heytaco]` (Node 24, zero dependencies; a ~40-line zip reader parses the XLSX files). It builds ledger entries with the kinds and key scheme above, imports twice, replays with the same fold as `core.replay`, and compares with `users.xlsx`. Output on 2026-11-24 (counts only):

```
csvRows 4726 (message 2837, reaction 1848, sticker 41)
identicalDuplicateRowsKept 0
redemptionRows 203 (fulfilled 53, approved 150; 71 matched by email only — people who left)
bonusEntries 0
historicalDeactivatedMembers 21, currentMembers 15
ledgerEntries 4929, ledgerEntriesAfterSecondImport 4929  → idempotent
givenByCurrentMembers 5093   (matches HeyTaco's "5,093 all-time", A5)
membersWithDiff { received 0, given 0, redeemable 0, any 0 }
```

Findings that shape the importer:

- Received, given and redeemable all reconcile with one `gift` entry per CSV row (stickers and reactions included) and one `spend` per redemption row; no special cases are needed.
- 71 of 203 redemptions belong to people not in `users.xlsx`, so matching must fall back to the redemption file's email (S102), creating deactivated members. Without that fallback 71 redemptions would be lost while the 15-user reconciliation would still pass, so the reconcile script also checks `imported redemptions = rows read`.
- HeyTaco exports only a per-user bonus total, so imported bonuses become one `bonus` entry per member (zero today).
- Imported gifts carry `allowance_day = null`; imported `spend` bypasses the S35 guard, because history is accepted as recorded.

---

## 10. Risks and how the design contains them

| Risk | Containment |
|---|---|
| Ledger shape is a one-way door | Eight kinds, proven against 3 years of real data; new kinds are additive |
| Sum-on-read gets slow | Indexed sums are cheap at 1000× Pearson; checkpoint table is an additive fix |
| Lock contention | Locks are per member and held for one short transaction; only bulk reset takes many |
| Slack retries / duplicate delivery | `command_log` key; rejections logged too |
| Edit/delete semantics | Recompute by diff against `netGiftedPerReceiver`; covered by Slack fixture replays (plan step 7) |
| Outbox lag for DMs | LISTEN/NOTIFY wakes the relay; poll fallback 1 s |
| Adapter rule creep | dependency-cruiser + "adapters only build commands and render events" review rule |
