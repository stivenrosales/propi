# Launch polish: admin UI and batch redemption

Objective: the admin screens look finished (aligned fields, consistent selects, readable member rows) and a member with many coins can redeem several units of a reward in one step.
Branch: feat/launch-polish (from feat/cloud). Delivery: ask-on-risk. Test runner: vitest on Postgres (`DATABASE_URL=postgresql://propi:propi@localhost:55433/propi pnpm test`), `pnpm typecheck`, `pnpm --filter @propi/web build` (typecheck does not cover apps/web), Playwright screenshots for UI.

## Specs

- **S1 (user, verbatim, 2026-11-26):** "Falta mejorar mas la ui amigo, revisa bien". Screenshots of propihq.com/admin/settings and /admin/members with marks:
  - Settings, "Currency and giving": the "Daily allowance" / "Admin allowance" pair is boxed in red. "Admin allowance" wraps to two lines, so its input sits lower than "Daily allowance"; one input shows a number spinner and the other does not; the pair is cramped next to Timezone and leaves an empty block under it.
  - Settings, "Boards, privacy and insights": an arrow points at the "Nudge day" select chevron (native select arrow crammed against the edge, looks unlike the other inputs).
  - Members: an arrow points at the Role select (same native chevron problem). Also visible: each member shows an internal UUID under the name; "Hide from boards" wraps to two lines; the current admin's row has no Active checkbox, so the columns don't line up.
  - Acceptance: every admin screen (settings, members, billing, rewards, insights, queues) reviewed at 1440px and 390px: labels and inputs aligned on one baseline per row, one select style with a proper chevron and padding used everywhere, number inputs consistent, no internal ids shown to people (show Slack handle or email instead, or nothing), checkbox labels that don't wrap awkwardly. Design reference: PRODUCT.md (Duolingo-like, warm, chunky).
- **S2 (user, verbatim, 2026-11-26):** "Adedmas de poder cobrar en lote si se tiene muchos coins". Earlier request from Jesús Chávez (vault, 2026-11-24): "Canjear varias unidades de un premio en un solo paso".
  - Assumption (decided by the parent): one redemption carries a quantity N ≥ 1; cost = unit cost × N; stock, per-member limits, budget and the Free plan limit apply to the whole quantity; one approval covers all N units; notifications, webhooks, CSV export and the redemption queue show the quantity. Quantity stored inside the existing `redemption.data` JSON (no migration); existing redemptions read as quantity 1.
  - Entry points: web shop (quantity stepper, total cost shown, max = what the balance, stock and limits allow) and Slack `/propi shop` flow if it already has a redeem action.

- **S3 (user, verbatim, 2026-11-26):** "En la alnding no dice naaada de la version cloud ni desde ahi se puede ingreasar a la app". Acceptance: the landing (apps/web marketing) presents the hosted cloud as the main path: hero says it runs hosted on propihq.com (Add to Slack, free up to 10 active members) with self-host as the alternative; a Pricing section with Free and Pro ($2 per active member per month, comped/self-host note) linked from the header nav; the header has a "Sign in" / "Open app" entry to /signin (and /app when a session exists, if cheap to detect server-side) visible on desktop and mobile; Add to Slack CTA repeated near pricing. Facts only from existing copy (site.ts, FAQ, why-propi); no invented features.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | delegated, parallel unit A (web admin UI); Risk: none | done (no Slack handle/email: data not stored) | 1ec29af, admin-ui.test 7/7 |
| T3 | S3 | delegated, parallel unit C (web marketing landing); Risk: none | done | c783e7a, landing.test 6/6 |
| T2 | S2 | delegated, parallel unit B (core/app/db/web shop/slack redemption quantity); Risk: item 1 (persisted redemption format), item 3 (webhook payload gains a field) | done | 8e1f110, 4b5605c; verifier no blockers |

## Log

- **L1 (2026-11-26, user, verbatim):** "[Image #11] Falta mejorar mas la ui amigo, revisa bien [Image #12] Adedmas de poder cobrar en lote si se tiene muchos coins"
- **L2 (2026-11-26, user, verbatim):** "En la alnding no dice naaada de la version cloud ni desde ahi se puede ingreasar a la app"
- **L3 (2026-11-26):** T3 landing committed c783e7a (header Sign in/Open app via signed cookie → marketing pages now dynamic; Pricing section; hero hosted badge). T2 committed 8e1f110: quantity in redemption.data, cost/internalCost stored as totals, stock CAS by N, events/webhooks carry quantity, CSV last column, web stepper, Slack "Redeem more" dropdown (2..10). Decisions taken by writer, kept: gift card N units = one card of N × value; Slack cap 10. No per-member limits exist in the domain. Independent verifier launched on 8e1f110 (items 1, 3).
- **L4 (2026-11-26):** verifier on 8e1f110: no blockers, all S2 rules PASS, 772/772. Advisories fixed inline in 4b5605c: refuse internal cost outside safe integers, Slack quantity must be plain digits, docs/api.md notes `quantity` (2 RED→GREEN tests).
- **L5 (2026-11-26):** T1 committed 1ec29af (shared Select with chevron, no number spinners, aligned field grids, settings allowance pair + timezone row, members: no UUID, locked admin row). Seam check: typecheck ok, web build ok, 781/781 on Postgres. Pushed feat/launch-polish and deployed propi@1ec29af: /, /signin, /privacy, /terms 200, /slack/install 307, landing has pricing + Sign in + hosted badge; server ready, scheduler 0 errors. Open: members table scrolls sideways at 390px; Slack handle/email not stored for members.
- **L6 (2026-11-26, user, verbatim):** "A mi no me genera costos? o como lo ves? Diria hasta 5, me aprece bien". Free limit lowered 10 → 5 (FREE_MEMBER_LIMIT, site.pricing; hero/FAQ/why-propi/terms now read the constant). d6307c9 deployed; live landing and /terms say 5. Suite 780/781 with apps/server/test/health.test.ts failing once in the full run and passing alone (flaky, unrelated).
