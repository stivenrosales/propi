# UI polish before the cloud version

Objective: fix the web UI and usability issues found by the 2026-11-25 Playwright e2e audit and the impeccable code audit, so the app is ready before multi-tenant work.
Branch: feat/ui-polish. Delivery: ask-on-risk. Test runner: vitest (web typecheck + Playwright screenshots for layout).

## Specs

- **S1 (user, verbatim):** "pulir la UI para que todo este ok o que falta". Design reference (user, verbatim): "Creo que Duolino amigo, referente". Context: PRODUCT.md.
- **S2 (user, verbatim, L14 of propi.md):** "revisar la UI de la app, que la veo y está bonita, pero tiene errores … y pues una prueba end to end para mejorar la UI y la usabilidad, que sea fácil de usar".
- **S3 primitives:** `cx` resolves conflicting Tailwind classes (Card `bg-ink` must win over `bg-white`); a shared submit button shows a pending state and disables itself; destructive ledger actions (archive and refund, deduct, reject, cancel, reset, reverse) ask for confirmation and share the `danger` tone; coral used as small text meets 4.5:1 via a darker text token.
- **S4 layout:** leaderboards date inputs never overlap other filters; admin/rewards has an empty state and side-card forms use one column; /signin has no horizontal scroll at 390px; admin nav keeps the active item visible (desktop and phone); member home "Given" card and allowance bar read correctly.
- **S5 currency and locale:** no hardcoded "USD"; reward and settings defaults come from the workspace budget currency.
- **S6 Slack names:** members show their Slack display name and avatar for every viewer, not "Member 87ead8".
- **S7 polish (P2/P3 from audits):** raw emoji codes stripped from history text, "1 people" plural, switch animates transform with 44px targets, value placeholders, badge labels, empty states with a next step, no em dashes in UI copy, disabled Slack link not focusable, KeyInput on every form, branded loading/error boundaries.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S3 | inline | done, 7709986 | cx.test.ts RED→GREEN 6/6; Button with pending + inline confirm; coral-ink token |
| T2 | S4 | inline | done, 7709986 | 48 Playwright shots: 0 console/network errors, 0 horizontal overflow at 390; active tab x=136-253 on phone |
| T3 | S5 | inline | done, 7709986 | currency from shop budget; no "USD" left in product pages |
| T4 | S6 | delegated (parallel unit, disjoint surface: db + server + web views/auth); Risk: item 1 (migration) | done, 71e6559 + follow-up fix | migration 20261125040000_member_profile; independent verifier PASS 6/6 |
| T5 | S7 | inline | done, 7709986 | readable-text.test.ts RED→GREEN; boundaries, badges, empty states, switch, plurals |

## Log

- **L1 (2026-11-25, user, verbatim):** "Amigo, vamos a trabajr en la version nube, pero antes pulir la UI para que todo este ok  o que falta, ya comprabmos que iona en slack y genial :D"
- **L2 (2026-11-25):** user named /impeccable for this phase; PRODUCT.md written with Duolingo as reference. Two read-only audits ran (Playwright: 1 P0, 7 P1; code: 7 P1, 10 P2, 4 P3). Audit side effects on dev DB only: reward "Audit mug", value "Curiosity", two redemptions.
- **L3 (2026-11-25):** T1-T3, T5 implemented inline; web tests 65/65, typecheck ok. Full suite 665/666: the failure (S28 App Home) was first reported as stale text, but a differential run (T4 server changes stashed → Home shows 2; with them → 0; an extra awaited read before the event → 2) shows a T4 race. Sent back to the T4 writer for one correction batch. Slack app needs `user_change` and `team_join` event subscriptions (manifest updated) before profile refresh works live.
- **L4 (2026-11-25):** writer could not reproduce the App Home 0; parent reran server.pg 6/6 and the full suite 2x green (666/666), verifier 9 runs green. Recorded as an unexplained one-off observation, not a confirmed bug. Commits: 71e6559 (profiles), 7709986 (UI). Verifier notes acted on: profile events no longer provision members (would add guests and skew isolation alerts), sign-in profile read guarded, home greeting and profile page use the stored Slack name and avatar like the frame.
- **Next:** user adds `user_change` and `team_join` event subscriptions in the Slack app; deploy to haiku-vps needs the user's go-ahead (migration runs on prod). Then the cloud (multi-tenant) version, starting with /pstack:architect.
