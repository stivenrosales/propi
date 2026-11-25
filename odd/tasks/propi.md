# Feature: Propi — open-source peer recognition (HeyTaco alternative)

- **Objective:** build, verify and deploy Propi end to end on `haiku-vps`, with Pearson as the first workspace.
- **Branch:** `feat/core`. **Delivery:** `ask-on-risk`. **Test runner:** Vitest (`pnpm test`).
- **Source of truth for rules:** `docs/spec.md` (S1–S108, plus S76a). **Architecture:** `docs/architecture.md`.

## Specs

- **S-DOMAIN:** every rule `S1`–`S108` (and `S76a`) in `docs/spec.md` is implemented and has at least one behavior test.
- **S-ARCH:** the design follows `docs/architecture.md`:
  - `core` is pure;
  - the `app` use cases run locks → claim → decide → commit;
  - Postgres has an append-only ledger and one `command_log`;
  - grafts G1–G10 are applied.
- **S-MIGRATION:** importing `data/heytaco/` gives 0 diffs on received, given and redeemable for current users, and rows read equal rows imported (G9). Re-import adds 0.
- **S-CONCURRENCY:** the G5 suite passes against real Postgres.
- **S-DEPLOY:** "lo quiero ya desplegado en mi vps y funcionando amigo, con todo operativo". Deploy target: `haiku-vps` (Easypanel), new project `propi`, own Postgres. Nothing else on the server is touched.
- **S-LANDING:** "hasta con landing genial, usando el modleo de Kie para elementos y cosas estetias para tener referncias y hacer varios cambios".
- **S-NAME:** the working name is `Propi`. License: AGPL-3.0.
- **S-SAFETY:**
  - No push to GitHub without the user's OK.
  - The user creates the Slack app and enters the tokens.
  - Installing in Pearson's Slack needs explicit confirmation, and runs in shadow mode first.
  - `data/` stays out of git.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S-ARCH, S-NAME | inline | in progress | scaffold: git, pnpm monorepo, AGPL, Vitest, CI, compose Postgres |
| T2 | S-DOMAIN | inline | todo | spec harness: one test file per spec section, starting RED |
| T3 | S1–S40, S-MIGRATION | inline (TDD) | todo | core: workspace, giving, allowance, ledger, adjustments |
| T4 | S-ARCH, S-CONCURRENCY | inline | todo | db (Prisma) + app use cases + G5 suite |
| T5 | S101–S105, S76a | inline | todo | HeyTaco importer + reconciliation |
| T6 | S41–S100, S106–S108 | delegated (parallel writers, disjoint core folders) | todo | values, shop, collab, rules, quests, stickers, levels, boards, notify, insights, milestones, pairing, api |
| T7 | S9–S29, S48, S106 | inline | todo | Slack adapter (Bolt) + fixtures + manifest |
| T8 | S-LANDING, S44, S80–S88 | delegated | todo | web: landing (Kie refs), admin, shop, dashboards |
| T9 | S-DEPLOY | inline | todo | Docker image, Easypanel project, migrate, smoke test |
| T10 | all | independent verifier | todo | ledger, concurrency and migration review |

## Log

- **L1 (2026-11-24, user, verbatim):** "En perason tenemos tacochop comprado, pero quiero hacer uno, la idea es que funcione con tacos o no se, algo similar, leugo quiero que el proeycto viva solo, aparte de pearson, pero pearosn sera el primer comprador de esto … por ahoa sera un proyecto opensource … priemro logica pura de todo"
- **L2 (2026-11-24, user):** full scope, not an MVP: "ahoa quiero hacerlo todo fulll completo".
- **L3 (2026-11-25, user, verbatim):** "Si, esta bien, pero nenicesta que te diga algo mas o ya todo ok? lo quiero ya desplegado en mi vps y funcionando amigo, con todo operativo y hasta con landing genial, usando el modleo de Kie para elementos y cosas estetias para tener referncias y hacer varios cambios, kie esta en el proeycto de soifa en esta pc, y el vps tiene slellavero apra entrar por sh en haikuserv"
- **L4 (2026-11-25):** name Propi accepted. AGPL, local commits, autonomous run, and agent orchestration approved.
- **L5 (2026-11-25):** read-only VPS check of `haiku-vps`: Easypanel + Traefik, 4 cores, ~3.6 GB RAM free, 81 GB disk free.
- **L6 (2026-11-25):** Kie lives in `~/cartas-sofia/generate.py`, using `KIE_API_KEY` from `.env`. Reading `.env` is denied to the agent, so the user will copy the key into `~/tacos/.env.local`.
