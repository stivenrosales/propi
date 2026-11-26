import { DEFAULT_MILESTONES } from "@propi/core/milestones";
import { DEFAULT_PAIRING } from "@propi/core/pairing";
import { Button, Card, CardTitle, Checkbox, Field, Flash, Input, KeyInput, LinkButton, PageHeader, Select, Textarea } from "@/components/app/ui";
import { formatDate } from "@propi/core/i18n";
import { settingsPage } from "@/i18n/admin-settings.messages";
import { shell } from "@/i18n/app-shell.messages";
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

export async function generateMetadata() {
  return { title: settingsPage.t(await getLocale())("title") };
}

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
  const locale = await getLocale();
  const lt = language.t(locale);
  const t = settingsPage.t(locale);
  const st = shell.t(locale);
  // Monday first, named in the reader's language (2024-01-01 was a Monday).
  const weekdays = Array.from({ length: 7 }, (_, i) => formatDate(locale, Date.UTC(2024, 0, 1 + i), { weekday: "long", timeZone: "UTC" }));
  const pair = pairing ?? DEFAULT_PAIRING;
  const ms = milestones ?? DEFAULT_MILESTONES;
  const tv = `${process.env.APP_URL ?? ""}/tv?display=${encodeURIComponent(tvToken(sessionSecret(), viewer.ws))}`;

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")}>
        <LinkButton href="/admin/billing">{t("billing")}</LinkButton>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardTitle>{t("currency")}</CardTitle>
          <form action={saveWorkspaceSettingsAction} className="fields grid gap-4 sm:grid-cols-2">
            <Field label={t("emoji")} hint={t("emojiHint")}>
              <Input name="primaryEmoji" defaultValue={s.currency.primaryEmoji} required />
            </Field>
            <Field label={t("extra")} hint={t("extraHint")}>
              <Input name="extraEmojis" defaultValue={formatExtraEmojis(s.currency.extraEmojis)} />
            </Field>
            <Field label={t("singular")}>
              <Input name="singular" defaultValue={s.currency.singular} required />
            </Field>
            <Field label={t("plural")}>
              <Input name="plural" defaultValue={s.currency.plural} required />
            </Field>
            <Field label={t("daily")} hint={t("dailyHint")}>
              <Input name="defaultDailyAllowance" type="number" min={1} defaultValue={s.defaultDailyAllowance} required />
            </Field>
            <Field label={t("adminDaily")} hint={t("adminDailyHint")}>
              <Input name="adminDailyAllowance" type="number" min={1} defaultValue={s.adminDailyAllowance} required />
            </Field>
            <Field label={t("timezone")} hint={t("timezoneHint")} className="sm:col-span-2">
              <Input name="timezone" defaultValue={s.timezone} required list="tz-list" />
            </Field>
            <datalist id="tz-list">
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t("giving")}</legend>
              <Checkbox name="reactionsEnabled" label={t("reactions")} defaultChecked={s.reactionsEnabled} />
              <Checkbox name="groupMentionsEnabled" label={t("groupMentions")} defaultChecked={s.groupMentionsEnabled} />
              <Checkbox name="privateChannelsAllowed" label={t("privateChannels")} defaultChecked={s.privateChannelsAllowed} />
              <Checkbox name="storeMessageText" label={t("storeText")} defaultChecked={s.storeMessageText} />
              <Checkbox name="botsMayGive" label={t("bots")} defaultChecked={s.botsMayGive} />
            </fieldset>
            <Button className="justify-self-start">{st("save")}</Button>
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
            <CardTitle>{t("boards")}</CardTitle>
            <form action={saveBoardSettingsAction} className="fields grid gap-4 sm:grid-cols-2">
              <fieldset className="grid gap-2 sm:col-span-2">
                <Checkbox name="showPrivateGifts" label={t("showPrivate")} defaultChecked={insights.showPrivateGifts} />
                <Checkbox name="giverMode" label={t("giverMode")} defaultChecked={insights.giverMode} />
                <Checkbox name="nudgeEnabled" label={t("nudge")} defaultChecked={insights.nudge.enabled} />
              </fieldset>
              <Field label={t("nudgeDay")}>
                <Select name="nudgeWeekday" defaultValue={insights.nudge.weekday}>
                  {weekdays.map((d, i) => (
                    <option key={d} value={i + 1}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("isolationWeeks")}>
                <Input name="isolationWeeks" type="number" min={1} defaultValue={insights.isolationWeeks} />
              </Field>
              <Field label={t("share")}>
                <Input name="minSharePercent" type="number" min={1} max={100} defaultValue={insights.reciprocity.minSharePercent} />
              </Field>
              <Field label={t("minGifts")}>
                <Input name="minGifts" type="number" min={1} defaultValue={insights.reciprocity.minGifts} />
              </Field>
              <Field label={t("shopUrl")} className="sm:col-span-2">
                <Input name="shopUrl" type="url" defaultValue={insights.shopUrl ?? ""} placeholder="https://…/app/shop" />
              </Field>
              <Button className="justify-self-start">{st("save")}</Button>
            </form>
          </Card>

          <Card>
            <CardTitle>{t("shop")}</CardTitle>
            <form action={saveShopSettingsAction} className="fields grid gap-4 sm:grid-cols-2">
              <KeyInput value={formKey()} />
              <Checkbox name="autoApprove" label={t("autoApprove")} defaultChecked={shop.autoApprove} className="sm:col-span-2" />
              <Field label={t("budget")} hint={t("budgetHint")}>
                <Input name="budgetMinor" type="number" min={0} defaultValue={shop.monthlyBudget?.minor ?? ""} />
              </Field>
              <Field label={t("budgetCurrency")} hint={t("budgetCurrencyHint")}>
                <Input name="budgetCurrency" defaultValue={shop.monthlyBudget?.currency ?? ""} placeholder="PEN" maxLength={3} />
              </Field>
              <Button className="justify-self-start">{st("save")}</Button>
            </form>
          </Card>
        </div>

        <Card>
          <CardTitle>{t("modules")}</CardTitle>
          <form action={saveModulesAction} className="fields grid gap-4 sm:grid-cols-2">
            <KeyInput value={formKey()} />
            <fieldset className="grid gap-2 sm:col-span-2">
              <Checkbox name="stickers" label={t("stickers")} defaultChecked={stickers.enabled} />
              <Checkbox name="pairing" label={t("pairing")} defaultChecked={pair.enabled} />
            </fieldset>
            <Field label={t("cadence")}>
              <Select name="pairingCadence" defaultValue={pair.cadence}>
                <option value="weekly">{t("weekly")}</option>
                <option value="biweekly">{t("biweekly")}</option>
                <option value="monthly">{t("monthly")}</option>
              </Select>
            </Field>
            <Field label={t("avoidRepeats")}>
              <Input name="avoidRepeatsWithin" type="number" min={0} defaultValue={pair.avoidRepeatsWithin} />
            </Field>
            <Field label={t("prompts")} hint={t("promptsHint")} className="sm:col-span-2">
              <Textarea name="prompts" defaultValue={pair.prompts.join("\n")} rows={3} />
            </Field>
            <Field label={t("celebrationChannel")} hint={t("celebrationChannelHint")}>
              <Input name="celebrationChannel" defaultValue={ms.channelId ?? ""} placeholder="C0123456" />
            </Field>
            <Field label={t("celebrationTime")}>
              <Input name="celebrationTime" type="time" defaultValue={ms.localTime} />
            </Field>
            <Field label={t("birthdayBonus")} hint={t("emptyNone")}>
              <Input name="birthdayBonus" type="number" min={1} defaultValue={ms.birthdayBonus ?? ""} />
            </Field>
            <Field label={t("anniversaryBonus")} hint={t("emptyNone")}>
              <Input name="anniversaryBonus" type="number" min={1} defaultValue={ms.anniversaryBonus ?? ""} />
            </Field>
            <Button className="justify-self-start">{t("saveModules")}</Button>
          </form>
        </Card>

        <Card className="self-start bg-ink text-cream">
          <CardTitle>
            <span className="text-cream">{t("tv")}</span>
          </CardTitle>
          <p className="text-sm text-cream/75">{t("tvBody")}</p>
          <Input readOnly value={tv} className="mt-3 bg-ink-raised font-mono text-xs text-cream" aria-label={t("tvLink")} />
        </Card>
      </div>
    </>
  );
}
