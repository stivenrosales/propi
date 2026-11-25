# Product

## Register

product

## Users

- **Members:** employees of a company (first customer: Pearson) who thank teammates in Slack with an emoji. They visit the web app occasionally, on desktop or phone, to check their balance, see the leaderboard, browse the shop and redeem a reward. Short visits, low patience, no training.
- **Admins:** HR or ops people who configure the currency, values, rewards and rules, and approve redemptions from a queue. They come back weekly and need to finish tasks quickly and without mistakes, since the ledger is append-only.

## Product Purpose

Propi is open-source peer recognition for Slack: give props, record them in an append-only ledger, and redeem them in a shop the team runs. It exists as a self-hosted alternative to closed per-seat bots like HeyTaco. Success means people give props without thinking, members understand their balance at a glance, and admins run the shop without support.

## Brand Personality

Warm, playful, generous. The reference is Duolingo: a friendly mascot, chunky shapes, bright committed color and small rewarding moments, while the task itself stays obvious and fast. Copy is short and human, never corporate.

## Anti-references

- Corporate HR suites (Workday, SAP SuccessFactors style): grey tables, dense forms, compliance tone. (Assumption, inferred from the Duolingo reference.)
- Generic SaaS admin templates: identical card grids, hero metrics, sidebar of grey icons.
- Gamification that gets in the way: confetti or animation that delays a task.

## Design Principles

1. **Delight around the task, never in its way.** Celebrate giving and redeeming; keep forms and queues plain and fast.
2. **Balance at a glance.** A member should know what they have, what they can give today and what they can buy within one look.
3. **Safe admin actions.** The ledger cannot be edited, so admin screens make consequences clear before the click, with sensible defaults (for example the workspace currency, never a hardcoded one).
4. **Slack is the home.** The web app complements Slack; names, avatars and emojis must match what people see there.
5. **Works on a phone.** Members open links from Slack on mobile; every member screen must work at 390px.

## Accessibility & Inclusion

Target WCAG 2.2 AA: text contrast on the cream and coral surfaces, visible focus (already defined), keyboard-operable forms and queues, and respect for `prefers-reduced-motion` on celebratory motion.
