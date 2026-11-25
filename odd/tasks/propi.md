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
  - GitHub: authorized 2026-11-25 to create a PUBLIC repo `stivenrosales/propi` and push, with a full README (L8). Scan for personal data before every push.
  - The user creates the Slack app and enters the tokens.
  - Installing in Pearson's Slack needs explicit confirmation, and runs in shadow mode first.
  - `data/` stays out of git.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S-ARCH, S-NAME | inline | done | commits c4a1c21, 22cd7ae + vitest fix; typecheck + 1 smoke test green |
| T2 | S-DOMAIN | delegated (context backstop) | done, commit feat(core) | spec harness: one test file per spec section, starting RED |
| T3 | S1–S40, S-MIGRATION | delegated (context backstop) | done, commit feat(core); verifier PASS after 1 correction (gift_closed) | core: workspace, giving, allowance, ledger, adjustments |
| T4 | S-ARCH, S-CONCURRENCY | delegated (parallel with T5, disjoint surfaces) | done, commit feat(db); 216 tests green on Postgres, 3 G5 todos wait for shop; dev pg on :55433 | db (Prisma) + app use cases + G5 suite |
| T5 | S101–S105, S76a | delegated (parallel with T4) | done, commit feat(import); reconcile ok, 0 diffs, 4726/4726, 203/203, re-import 0 | HeyTaco importer + reconciliation |
| T6 | S41–S100, S106–S108 | delegated (parallel writers, disjoint core folders) | done: 6 commits; verifier PASS after 1 correction (module persistence); 506 tests on Postgres; spec coverage 109/109 | values, shop, collab, rules, quests, stickers, levels, boards, notify, insights, milestones, pairing, api |
| T7 | S9–S29, S48, S106 | delegated (parallel with T8, workflow propi-apps wf_225d19ca-c65) | in progress | Slack adapter (Bolt) + fixtures + manifest |
| T8 | S-LANDING, S44, S80–S88 | delegated (landing in worktree branch feat/landing, parallel) | landing in progress; brand kit done (commit feat(brand)) | web: landing (Kie refs), admin, shop, dashboards |
| T9 | S-DEPLOY | inline | todo; target: docker stack /opt/propi + traefik file config, host propi.swnb5v.easypanel.host (wildcard DNS + cert verified), same pattern as /opt/mmtp-cobranzas | Docker image, Easypanel project, migrate, smoke test |
| T10 | all | independent verifier | todo | ledger, concurrency and migration review |

## Log

- **L1 (2026-11-24, user, verbatim):** "En perason tenemos tacochop comprado, pero quiero hacer uno, la idea es que funcione con tacos o no se, algo similar, leugo quiero que el proeycto viva solo, aparte de pearson, pero pearosn sera el primer comprador de esto … por ahoa sera un proyecto opensource … priemro logica pura de todo"
- **L2 (2026-11-24, user):** full scope, not an MVP: "ahoa quiero hacerlo todo fulll completo".
- **L3 (2026-11-25, user, verbatim):** "Si, esta bien, pero nenicesta que te diga algo mas o ya todo ok? lo quiero ya desplegado en mi vps y funcionando amigo, con todo operativo y hasta con landing genial, usando el modleo de Kie para elementos y cosas estetias para tener referncias y hacer varios cambios, kie esta en el proeycto de soifa en esta pc, y el vps tiene slellavero apra entrar por sh en haikuserv"
- **L4 (2026-11-25):** name Propi accepted. AGPL, local commits, autonomous run, and agent orchestration approved.
- **L5 (2026-11-25):** read-only VPS check of `haiku-vps`: Easypanel + Traefik, 4 cores, ~3.6 GB RAM free, 81 GB disk free.
- **L6 (2026-11-25):** Kie lives in `~/cartas-sofia/generate.py`, using `KIE_API_KEY` from `.env`. Reading `.env` is denied to the agent, so the user will copy the key into `~/tacos/.env.local`.
- L7 (2026-11-25): T1 done. Launched workflow propi-foundation (run wf_b1ec12e8-31a): foundation writer, then postgres + importer writers in parallel, then an independent verifier with one bounded correction. Delegated because the parent context passed the ~150k backstop. Writers do not commit; the parent commits by unit.
- L8 (2026-11-25, user, verbatim): "No, ienss uqe hacerlo todo amigo, hasta lo de easypanel, y subir a githubn, hascer su dreadme y todo, por eso te digo que quiero que lo hagas todo, por eos un goal?"
- L9 (2026-11-25): GitHub repo https://github.com/stivenrosales/propi created public; main and feat/core pushed after a PII scan. Brand: Kie GPT Image 2.6 Flare, logo A (token) chosen and cropped into 3 SVG variants. Deploy route decided: Easypanel API needs panel credentials, so follow the existing /opt/mmtp-cobranzas pattern (swarm stack + traefik file provider) on the Easypanel wildcard domain.
- L10 (2026-11-25): foundation workflow done. The verifier found a real blocker (an admin reversal was undone by a later edit); it was fixed with gift_closed and rechecked PASS. Parent spot check: typecheck ok, 216 tests on Postgres, reconcile ok. Landing merged (Next.js, standalone). Pushed. Modules workflow launched with 4 writers, an integrator and a verifier.
- L11 (2026-11-25): modules workflow done; parent spot check: typecheck ok, 506/506 tests on Postgres, coverage 109/109, reconcile ok. Landing deployed live at https://propi.swnb5v.easypanel.host (200, valid TLS). Apps workflow launched: db persistence, then server and web in parallel, then a security verifier.
