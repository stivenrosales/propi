# Domain Specification

Status: approved by the user 2026-11-24; all assumptions resolved.

This spec defines the business rules of the peer-recognition platform. It does not cover technology. Every rule has an ID `S<n>`, and each one must end up with at least one behavior test. Examples use 🌮, but the domain itself is currency-agnostic (D2).

- **Source tags.** `[HT]` means HeyTaco behaves this way, verified in Pearson's admin UI, its exports, or its docs. `[NEW]` means we go beyond HeyTaco.
- **Assumptions.** Points marked `ASSUMPTION A<n>` are unresolved; the full list is at the end.

## Glossary

| Term | Meaning |
|---|---|
| Workspace | One organization installation (Pearson is one workspace). |
| Member | A person in the workspace, linked to one or more platform identities (Slack user, Teams user). |
| Unit | The workspace's recognition currency ("taco"). It is configurable. |
| Gift | One giver → one receiver transfer of N units, with a reason. |
| Ledger entry | An immutable record that changes a balance. |
| Received | Lifetime units received through peer gifts. It never decreases (except via reversal). |
| Redeemable | Units available to spend in the shop. |
| Allowance | The units a member may still give today. |

---

## 1. Workspace and currency

- **S1 [NEW]** A workspace defines its currency: one primary emoji, a singular name, and a plural name. Example: `:taco:`, "taco", "tacos". All user-facing text uses these names. Domain code never hard-codes them.
- **S2 [NEW]** A workspace can define extra gift emojis, each worth a fixed integer value ≥ 1. Example: `:fire:` = 3. A message's amount is the sum of the values of its recognized emojis.
- **S3 [NEW]** A workspace has a timezone (IANA, e.g. `America/Lima`). All "day", "week" and "month" boundaries use it.
- **S4 [NEW]** Currency changes apply only to future gifts. Past ledger entries keep their amounts and are never rewritten.

## 2. Members and roles

- **S5 [HT]** Every member has the role `admin` or `member`. Whoever installs the app becomes the first admin. A member cannot change their own role.
- **S6 [NEW]** A third role, `approver`, may approve or reject redemptions and quest submissions without full admin rights.
- **S7 [HT]** Members can be deactivated. A deactivated member cannot give or receive, keeps their history, and disappears from leaderboards by default.
- **S8 [NEW]** Bot users and the app itself are never members and cannot receive units. An admin setting decides whether bots may give units (HeyTaco has this setting; Pearson has it ON).

## 3. Giving by message

- **S9 [HT]** A gift message mentions ≥ 1 receivers and contains ≥ 1 recognized emoji in a channel where the app is present.
  - Amount per receiver = the sum of the emoji values (S2).
  - Example: `@Lind gracias por la sesión :taco: :taco: :taco:` gives Lind 3.
- **S10 [HT]** When several people are mentioned, each receives the full amount, and the giver's cost is the amount × the number of receivers.
  - Example: `@Ana @Diana :taco::taco:` costs 4.
- **S11 [HT]** The giver is excluded from the receivers. A message whose only receiver is the giver is not a gift.
- **S12 [NEW]** User-group mentions (`@team`) are a workspace setting (default ON). When ON, they are expanded to the group's active members at gift time, excluding the giver, and capped by the allowance like any other gift. When OFF, group mentions are ignored. (A1 resolved.)
- **S13 [HT + NEW]** If the total cost exceeds the giver's allowance, no units move. HeyTaco ignores this silently. We instead send the giver a private notice with the cost, the remaining allowance, and how to fix it.
- **S14 [HT]** The whole message text is stored as the gift reason, unless the workspace disables "save message content" (S70).
- **S15 [NEW]** Hashtags in the message (`#ownership`) are attached as value tags (section 9).
- **S16 [HT]** Gifts in direct messages are not allowed. Gifts in private channels are allowed only if the workspace setting is ON.
- **S17 [NEW]** Every incoming platform event has a unique event key (platform + message id). Processing the same event twice must produce the same result as processing it once.

## 4. Giving by reaction

- **S18 [HT]** When reactions are enabled, reacting with a recognized emoji to a message gives that emoji's value.
  - It goes to the people mentioned in that message.
  - If the message mentions nobody, it goes to the message author.
- **S19 [HT]** A reaction gift consumes the reactor's allowance like a message gift.
  - Verified: a reaction at 12:56 produced "You have 4 tacos left to give out today".
- **S20 [NEW]** Each giver gets at most one reaction gift per (message, emoji). HeyTaco's export shows the same giver reacting twice to one message within 5 s; we count that once. (A2 resolved.) Removing the reaction (S21) and adding it again later the same day is a new intent and gives again (architecture G8).
- **S21 [NEW]** Removing a reaction within the same allowance day reverses that reaction gift and returns the allowance. After that day, removing it changes nothing.
- **S22 [HT]** Nobody can react-gift to their own message when they are its only receiver (S11 applies).

## 5. Edits and deletions

- **S23 [NEW]** HeyTaco ignores edits. We handle them:
  - If an edited message newly qualifies as a gift and no gift exists for it yet, it is processed as a new gift at edit time.
  - If an existing gift message is edited, the gift is recomputed and the difference is applied as a reversal or a top-up, still under the allowance rules.
  - (A3 resolved: recompute on edit.)
  - An admin-reversed (S38) or same-day-deleted (S24) gift is final: later edits of its message are refused with `gift_closed`.
- **S24 [NEW]** Deleting a gift message within the same allowance day reverses its gifts and returns the giver's allowance. After that day, the gift stands.

## 6. Daily allowance

- **S25 [HT]** Every member has a daily allowance. It defaults to the workspace value (5) and an admin can override it per member (Pearson: one member at 8, one at 10).
- **S26 [HT]** Admins have their own workspace default allowance.
- **S27 [HT]** Allowance resets at 00:00 in the workspace timezone. Unused allowance does not carry over.
- **S28 [NEW]** A member can see their remaining allowance at any time with a command and in the App Home.
- **S29 [HT]** Every successful gift sends the giver a private confirmation with the remaining allowance.

## 7. Ledger and balances

- **S30 [NEW]** All balance changes are append-only ledger entries. Each entry records:
  - the type,
  - the amount (a signed integer),
  - the member,
  - the counterpart (if any),
  - the cause (gift id, redemption id, rule id, admin id),
  - the timestamp,
  - a reason.

  Entries are never updated or deleted.
- **S31 [HT]** `received` = the sum of peer gifts received − reversals of those gifts. Bonuses, quest rewards and rule awards do not count toward `received`, leaderboards or levels.
- **S32 [HT]** `redeemable` = `received` + bonuses + quest rewards + rule awards + refunds − redemptions − deductions.
  - Verified: `received + bonuses − redeemed = redeemable` holds for 15/15 Pearson users.
- **S33 [HT]** `given` = the sum of units the member gave through gifts, net of reversals.
- **S34 [NEW]** Every balance can be rebuilt by replaying the ledger. A stored projection that differs from the replay is a bug.
- **S35 [HT]** Redeemable may go negative only through an admin reversal or deduction. A redemption can never make it negative.

## 8. Admin adjustments

- **S36 [HT]** **Bonus.** An admin grants N > 0 units to one or many members, with a reason. It is added to redeemable only (S31).
- **S37 [NEW]** **Deduction.** An admin removes N > 0 units from redeemable, with a mandatory reason.
- **S38 [NEW]** **Gift reversal.** An admin can reverse a specific gift (abuse, a mistake). It undoes received/given and adjusts redeemable. The giver's allowance is not restored. A reversed gift is final, like a same-day-deleted one (S24): later edits of its message are refused with `gift_closed`.
- **S39 [HT]** **Bulk reset.** An admin can reset everyone's redeemable to 0. It is recorded as one deduction entry per member, and `received` and history stay untouched.
- **S40 [NEW]** Every admin adjustment is listed in an audit log with actor, time and reason.

## 9. Values (tags)

- **S41 [HT]** An admin defines the workspace values. Each value has a name, an optional hashtag (`#ownership`) and an optional emoji (`:muscle:`).
- **S42 [NEW]** A gift is tagged with a value when its message contains the value's hashtag or emoji. Any member can also add a value to an existing gift later through a reaction with that value's emoji (Disco-style).
- **S43 [NEW]** Values are reported per member and per period (who embodies which value).

## 10. Rewards catalog (shop)

- **S44 [HT]** An admin creates rewards with these fields:
  - title,
  - description,
  - image,
  - cost in units (> 0),
  - optional stock,
  - optional variants (each with its own stock),
  - categories,
  - an internal monetary cost (visible to admins only),
  - redemption instructions.
- **S45 [HT]** Reward lifecycle: `draft → active → archived`. Only `active` rewards can be redeemed. An archived reward keeps its redemption history.
- **S46 [HT]** When stock reaches 0, the reward cannot be redeemed until restocked.
- **S47 [NEW]** A workspace may set a monthly redemption budget in money. A redemption that would exceed the remaining budget is refused with a clear message.
- **S48 [NEW]** Members can redeem from inside the chat platform (App Home / modal) as well as from the web. HeyTaco is web-only, and that is a top complaint.

## 11. Redemptions

- **S49 [NEW]** Redemption states: `pending → approved → fulfilled`, `pending → rejected`, `approved → cancelled`. HeyTaco only has unfulfilled/fulfilled, with no approval.
- **S50 [NEW]** Creating a redemption checks that redeemable ≥ cost and that stock and budget are available. On creation it immediately debits redeemable and reserves stock.
  - Example: 42 redeemable, reward cost 12 → pending, 30 redeemable.
- **S51 [NEW]** Rejection or cancellation refunds the full cost and releases stock in the same atomic operation as the state change.
- **S52 [NEW]** A workspace may enable auto-approval globally or per reward. Then `pending` moves straight to `approved`.
- **S53 [NEW]** `fulfilled` can be set by an approver in the app, or by an external system through the API (D3). Fulfilment is idempotent: marking a fulfilled redemption fulfilled again is a no-op.
- **S54 [NEW]** Every state change emits a webhook event (`redemption.created`, `.approved`, `.rejected`, `.cancelled`, `.fulfilled`) and notifies the member privately.
- **S55 [HT]** An admin can create a manual redemption on behalf of a member.

## 12. Collaborative rewards

- **S56 [HT]** A collaborative reward has a goal in units. Members contribute redeemable units, and progress is visible to all.
- **S57 [HT]** When contributions reach the goal, a single redemption is created on behalf of the contributors, and the contributors are notified.
- **S58 [NEW]** If the reward is archived or its deadline passes before the goal is reached, all contributions are refunded. HeyTaco leaves this undocumented and its contributions are irreversible.
- **S59 [NEW]** A contribution that would overshoot the goal is capped at the remaining amount.

## 13. Automatic award rules

- **S60 [NEW]** An admin defines award rules. Each rule has:
  - a period (week, month, quarter),
  - a criterion (top N receivers, top N givers, gave to ≥ K distinct people, streak of P consecutive periods with ≥ 1 gift given, most-tagged with value V),
  - a reward in units,
  - optional tie handling (all tied members win, by default).
- **S61 [NEW]** Rules are evaluated after the period closes, in the workspace timezone. Results are announced in a configured channel and DM'd to the winners.
- **S62 [NEW]** Evaluating a rule for a given period is idempotent: re-running it never pays twice.
- **S63 [NEW]** Rule awards go to redeemable only (S31). Example: "top receiver of November gets +20" → the winner's redeemable rises 20, and their received does not change.

## 14. Quests

- **S64 [HT]** An admin creates a quest with:
  - title, description, image;
  - reward mode: fixed N, approver's choice, or recognition only;
  - who submits: self, nomination, or both;
  - proof required or not;
  - approval required or not;
  - a public timeline with comments, on or off;
  - a per-submitter cap, a team cap, and a cooldown;
  - an open/close window.
- **S65 [HT]** Quest lifecycle: `draft → open → closed`. Submissions are accepted only while open and within its window. Pending submissions can still be reviewed after close.
- **S66 [HT]** Submission states: `pending → approved`, `pending → rejected`. A rejected submitter may resubmit, subject to cooldown. Without required approval, a submission is approved on submit.
- **S67 [HT]** Approved quest rewards go to redeemable only (S31).
- **S68 [NEW]** Quest completion can be triggered automatically by an event rule (e.g. "first gift given"). HeyTaco lists this as roadmap.

## 15. Privacy and data

- **S69 [HT]** Gifts in private channels are stored but hidden from public feeds and profiles, unless the workspace enables showing them.
- **S70 [HT]** The workspace may disable storing message text. Gifts then keep amount, people, channel, time and value tags (tags still work, unlike HeyTaco).
- **S71 [NEW]** An admin can export everything (gifts, ledger, redemptions, members) as CSV at any time, with no date-range cap.
- **S72 [NEW]** Uninstalling never deletes data without an explicit, separate deletion confirmation. HeyTaco deletes on cancel.

## 16. Stickers (optional module)

Stickers are rarely used: 41 of 4,726 historical gifts at Pearson. The module is OFF by default and kept simple. There are no unlock formulas.

- **S73 [HT]** When enabled, an admin defines stickers. Each has a name, an image, a receiver count (or "whole channel") and units per receiver. Pearson's current set can be preloaded:

  | Sticker | Receivers × units |
  |---|---|
  | Confetti | whole channel × 1 |
  | High Five | 3 × 1 |
  | Piñata | 6 × 1 |
  | Trophy | 1 × 5 |
  | Truck | 5 × 2 |
  | Rain | 10 × 1 |
  | Rockstars | 5 × 1 |
  | Tacocat | 1 × 2 |

- **S74 [HT]** Sticker gifts do not consume the daily allowance and count toward received.
- **S75 [NEW]** Availability is a plain monthly quota per member per sticker (default 1). It resets at the start of each month in the workspace timezone. (A4 resolved: no secret unlock rules.)
- **S76 [HT]** An admin can grant extra sticker uses to a member.
- **S76a [NEW]** The migration imports historical sticker gifts as gifts, whether or not the module is enabled.

## 17. Levels and avatars

- **S77 [HT]** A member's level derives from units received plus given, using a published threshold table (HeyTaco's is secret). A level has a number and a title.
- **S78 [NEW]** Levels are recomputed from the ledger (S34) and never stored as truth.
- **S79 [HT]** Members can choose an avatar from a set. Some avatars unlock at certain levels.

## 18. Leaderboards

- **S80 [HT]** Leaderboards: `received`, `given`, `combined`. Timeframes: today, week, month, year, all-time, custom range. Filters by channel. Excluded members and deactivated members are hidden.
- **S81 [HT]** Giver Mode shows members only the `given` leaderboard. Admins always see all.
- **S82 [NEW]** Leaderboards also filter by value tag.

## 19. Notifications and reports

- **S83 [HT]** Receivers get a private notification per gift, showing the giver, the amount, the channel and the message.
- **S84 [HT]** Each member gets a weekly report covering:
  - team totals vs the same point last month,
  - top givers,
  - their own giving vs last month,
  - who they gave to,
  - their redeemable balance and the shop link.
- **S85 [HT]** Each member can turn each notification type on or off.
- **S86 [NEW]** A weekly recognition nudge (e.g. Friday) reminds members who have unused allowance this week. Workspaces can turn it off.
- **S87 [HT]** A display mode (TV) shows the live feed and leaderboard for office screens.

## 20. Insights

- **S88 [NEW]** Admins see these team metrics per period:
  - total and per-capita gifts,
  - % of members who gave,
  - % of gifts with a value,
  - top value tags,
  - shop economy (earned, spent, outstanding, budget used).
- **S89 [NEW]** Isolation alert: an admin or manager is notified when an active member has received nothing for N weeks (default 3).
- **S90 [NEW]** Reciprocity check: pairs where ≥ X% of each one's gifts go to the other, within a period with ≥ Y gifts, are flagged for admin review. Nothing is blocked automatically.
- **S91 [NEW]** A monthly AI digest summarizes, per team and per member:
  - what people were recognized for, grouped by value and theme,
  - with quotes linked to the source gifts.

  It is generated only from stored gift text (S70 off disables it).

## 21. Celebrations (milestones)

- **S92 [HT]** Members have an optional birthday (day and month) and start date. The member or an admin sets them.
- **S93 [HT]** On the day, a celebration message posts to a configured channel at a configured local time. The member chooses public, private (DM only) or none.
- **S94 [NEW]** A workspace may grant an automatic bonus on birthdays and work anniversaries (amount configurable, recorded as a bonus).

## 22. Pairing chats

- **S95 [HT]** On a schedule (weekly, biweekly, monthly), opted-in members are paired, or grouped in 3 when the count is odd, in a group DM with a conversation prompt.
- **S96 [HT]** Pairing prefers people who have exchanged the fewest gifts with each other, and avoids repeating a pair within the last K rounds.

## 23. API and webhooks

- **S97 [NEW]** A REST API exposes members, balances, gifts, ledger entries, rewards, redemptions, quests and leaderboards. Writes: bonuses, deductions, redemption transitions (approve, reject, fulfil), and rewards CRUD.
- **S98 [NEW]** API tokens are workspace-scoped, carry explicit scopes, and can be revoked. Every write records the token as its actor.
- **S99 [NEW]** Webhooks are signed (HMAC with a per-endpoint secret), retried with backoff, and carry an event id so receivers can deduplicate. Events cover:
  - gifts,
  - redemptions (S54),
  - quest submissions,
  - rule awards,
  - member changes.
- **S100 [NEW]** API write operations accept an idempotency key. Retrying the same key returns the original result.

## 24. Migration from HeyTaco

- **S101 [NEW]** The importer reads HeyTaco's exports:
  - the activity CSVs: receiver, giver, timestamp in `America/Bogota`, channel, message, tacos, tags, and type `message` / `reaction` / `sticker`;
  - `users.xlsx`;
  - the redemption files.
- **S102 [NEW]** Members are matched by Slack user id where available, else by email. An unmatched historical person (36 historical receivers vs 15 current users) is imported as a deactivated member.
- **S103 [NEW]** After import, every current member's received, given and redeemable equals HeyTaco's `users.xlsx` values. The reconciliation script must report a diff of 0, as the baseline does today.
- **S104 [NEW]** Imported redemptions keep their fulfilled flag: `1` → fulfilled, `0` → approved (awaiting fulfilment).
- **S105 [NEW]** Re-running the import over the same files changes nothing (idempotent).

## 25. Platforms

- **S106 [NEW]** Slack is the first platform. Microsoft Teams follows with the same domain rules. Platform adapters translate events into domain commands and never contain business rules.
- **S107 [NEW]** A member may link identities from several platforms, and their balance is shared across them.

## 26. Gift cards (optional module)

- **S108 [HT]** A workspace may fund a prepaid balance with a gift-card provider. Gift-card rewards are fulfilled automatically on approval. A redemption is refused if the prepaid balance is insufficient.

---

## Resolved assumptions (2026-11-24)

| ID | Decision |
|---|---|
| A1 | `@group` mentions: a workspace setting, default ON (S12) |
| A2 | Duplicate reaction counts once (S20) |
| A3 | An edited gift message is recomputed (S23) |
| A4 | Stickers are an optional module, OFF by default, with a simple monthly quota (S73–S76a) |
| A5 | HeyTaco's "5,093 all-time given" = tacos given by the 15 current users only. The full export (6,557) includes people who have left. Verified by script. |
