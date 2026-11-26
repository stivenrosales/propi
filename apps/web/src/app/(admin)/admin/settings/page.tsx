import { DEFAULT_MILESTONES } from "@propi/core/milestones";
import { DEFAULT_PAIRING } from "@propi/core/pairing";
import { Button, Card, CardTitle, Checkbox, Field, Flash, Input, KeyInput, LinkButton, PageHeader, Select, Textarea } from "@/components/app/ui";
import { getLocale } from "@/i18n/locale";
import { LANGUAGE_NAMES, language } from "@/i18n/language.messages";
import { saveBoardSettingsAction, saveModulesAction, saveShopSettingsAction, saveWorkspaceSettingsAction } from "@/server/actions/admin";
import { saveWorkspaceLanguageAction } from "@/server/actions/language";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { sessionSecret } from "@/server/env";
import { propi } from "@/server/propi";
import { formatExtraEmojis } from "@/server/settings-form";
import { tvToken } from "@/server/tv-token";

export const metadata = { title: "Settings" };

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// S1-S3 currency and timezone, S25-S26 allowances, S8/S12/S14/S16/S18 giving toggles, S69/S70 privacy,
// S47/S52 shop, S81/S86/S89/S90 boards and insights, modules (stickers S73, pairing S95, milestones S93).
export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const p = propi();
  const [s, insights, shop, stickers, pairing, milestones] = await Promise.all([
    p.ports.directory.settings(viewer.ws),
    p.insights.source.settings(viewer.ws),
    p.shop(viewer.ws).shopSettings(),
    p.engagement.stickers.config(viewer.ws),
    p.engagement.pairing.config(viewer.ws),
    p.engagement.milestones.config(viewer.ws),
  ]);
  const lt = language.t(await getLocale());
  const pair = pairing ?? DEFAULT_PAIRING;
  const ms = milestones ?? DEFAULT_MILESTONES;
  const tv = `${process.env.APP_URL ?? ""}/tv?display=${encodeURIComponent(tvToken(sessionSecret(), viewer.ws))}`;

  return (
    <>
      <PageHeader title="Settings" eyebrow="Admin">
        <LinkButton href="/admin/billing">Plan and billing</LinkButton>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardTitle>Currency and giving</CardTitle>
          <form action={saveWorkspaceSettingsAction} className="fields grid gap-4 sm:grid-cols-2">
            <Field label="Gift emoji" hint="Worth 1 each, e.g. :taco:">
              <Input name="primaryEmoji" defaultValue={s.currency.primaryEmoji} required />
            </Field>
            <Field label="Extra emojis" hint="Comma separated, e.g. :fire: = 3">
              <Input name="extraEmojis" defaultValue={formatExtraEmojis(s.currency.extraEmojis)} />
            </Field>
            <Field label="Singular name">
              <Input name="singular" defaultValue={s.currency.singular} required />
            </Field>
            <Field label="Plural name">
              <Input name="plural" defaultValue={s.currency.plural} required />
            </Field>
            <Field label="Daily allowance" hint="What each member can give per day">
              <Input name="defaultDailyAllowance" type="number" min={1} defaultValue={s.defaultDailyAllowance} required />
            </Field>
            <Field label="Admin allowance" hint="What each admin can give per day">
              <Input name="adminDailyAllowance" type="number" min={1} defaultValue={s.adminDailyAllowance} required />
            </Field>
            <Field label="Timezone" hint="IANA name. Days, weeks and months use it." className="sm:col-span-2">
              <Input name="timezone" defaultValue={s.timezone} required list="tz-list" />
            </Field>
            <datalist id="tz-list">
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">Giving</legend>
              <Checkbox name="reactionsEnabled" label="Reactions give props" defaultChecked={s.reactionsEnabled} />
              <Checkbox name="groupMentionsEnabled" label="@group mentions give to every member" defaultChecked={s.groupMentionsEnabled} />
              <Checkbox name="privateChannelsAllowed" label="Allow gifts in private channels" defaultChecked={s.privateChannelsAllowed} />
              <Checkbox name="storeMessageText" label="Save message text with gifts" defaultChecked={s.storeMessageText} />
              <Checkbox name="botsMayGive" label="Bots may give props" defaultChecked={s.botsMayGive} />
            </fieldset>
            <Button className="justify-self-start">Save</Button>
          </form>
        </Card>

        <div className="grid gap-5">
          <Card>
            <CardTitle>{lt("settings.title")}</CardTitle>
            <form action={saveWorkspaceLanguageAction} className="fields grid gap-4 sm:grid-cols-2">
              <Field label={lt("settings.field")} hint={lt("settings.hint")} className="sm:col-span-2">
                <Select name="language" defaultValue={s.language ?? "en"}>
                  <option value="en" lang="en">{LANGUAGE_NAMES.en}</option>
                  <option value="es" lang="es">{LANGUAGE_NAMES.es}</option>
                </Select>
              </Field>
              <Button className="justify-self-start">{lt("settings.save")}</Button>
            </form>
          </Card>

          <Card>
            <CardTitle>Boards, privacy and insights</CardTitle>
            <form action={saveBoardSettingsAction} className="fields grid gap-4 sm:grid-cols-2">
              <fieldset className="grid gap-2 sm:col-span-2">
                <Checkbox name="showPrivateGifts" label="Show private-channel gifts in feeds and profiles" defaultChecked={insights.showPrivateGifts} />
                <Checkbox name="giverMode" label="Giver mode: members only see the given board" defaultChecked={insights.giverMode} />
                <Checkbox name="nudgeEnabled" label="Weekly nudge to give" defaultChecked={insights.nudge.enabled} />
              </fieldset>
              <Field label="Nudge day">
                <Select name="nudgeWeekday" defaultValue={insights.nudge.weekday}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i + 1}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Isolation alert after (weeks)">
                <Input name="isolationWeeks" type="number" min={1} defaultValue={insights.isolationWeeks} />
              </Field>
              <Field label="Reciprocity share (%)">
                <Input name="minSharePercent" type="number" min={1} max={100} defaultValue={insights.reciprocity.minSharePercent} />
              </Field>
              <Field label="Reciprocity minimum gifts">
                <Input name="minGifts" type="number" min={1} defaultValue={insights.reciprocity.minGifts} />
              </Field>
              <Field label="Shop link for weekly reports" className="sm:col-span-2">
                <Input name="shopUrl" type="url" defaultValue={insights.shopUrl ?? ""} placeholder="https://…/app/shop" />
              </Field>
              <Button className="justify-self-start">Save</Button>
            </form>
          </Card>

          <Card>
            <CardTitle>Shop</CardTitle>
            <form action={saveShopSettingsAction} className="fields grid gap-4 sm:grid-cols-2">
              <KeyInput value={formKey()} />
              <Checkbox name="autoApprove" label="Approve redemptions automatically" defaultChecked={shop.autoApprove} className="sm:col-span-2" />
              <Field label="Monthly budget (cents)" hint="Empty for no budget">
                <Input name="budgetMinor" type="number" min={0} defaultValue={shop.monthlyBudget?.minor ?? ""} />
              </Field>
              <Field label="Currency" hint="ISO code, for example PEN">
                <Input name="budgetCurrency" defaultValue={shop.monthlyBudget?.currency ?? ""} placeholder="PEN" maxLength={3} />
              </Field>
              <Button className="justify-self-start">Save</Button>
            </form>
          </Card>
        </div>

        <Card>
          <CardTitle>Modules</CardTitle>
          <form action={saveModulesAction} className="fields grid gap-4 sm:grid-cols-2">
            <KeyInput value={formKey()} />
            <fieldset className="grid gap-2 sm:col-span-2">
              <Checkbox name="stickers" label="Stickers" defaultChecked={stickers.enabled} />
              <Checkbox name="pairing" label="Pairing chats" defaultChecked={pair.enabled} />
            </fieldset>
            <Field label="Pairing cadence">
              <Select name="pairingCadence" defaultValue={pair.cadence}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>
            <Field label="Avoid repeat pairs for (rounds)">
              <Input name="avoidRepeatsWithin" type="number" min={0} defaultValue={pair.avoidRepeatsWithin} />
            </Field>
            <Field label="Conversation prompts" hint="One per line" className="sm:col-span-2">
              <Textarea name="prompts" defaultValue={pair.prompts.join("\n")} rows={3} />
            </Field>
            <Field label="Celebration channel" hint="Slack channel ID, e.g. C0123456">
              <Input name="celebrationChannel" defaultValue={ms.channelId ?? ""} placeholder="C0123456" />
            </Field>
            <Field label="Celebration time">
              <Input name="celebrationTime" type="time" defaultValue={ms.localTime} />
            </Field>
            <Field label="Birthday bonus" hint="Empty for none">
              <Input name="birthdayBonus" type="number" min={1} defaultValue={ms.birthdayBonus ?? ""} />
            </Field>
            <Field label="Anniversary bonus" hint="Empty for none">
              <Input name="anniversaryBonus" type="number" min={1} defaultValue={ms.anniversaryBonus ?? ""} />
            </Field>
            <Button className="justify-self-start">Save modules</Button>
          </form>
        </Card>

        <Card className="self-start bg-ink text-cream">
          <CardTitle>
            <span className="text-cream">TV mode</span>
          </CardTitle>
          <p className="text-sm text-cream/75">Open this link on an office screen. It shows the live feed and the leaderboard, with no sign-in. Anyone with the link can view it; rotating SESSION_SECRET revokes it.</p>
          <Input readOnly value={tv} className="mt-3 bg-ink-raised font-mono text-xs text-cream" aria-label="TV link" />
        </Card>
      </div>
    </>
  );
}
