import { Lock } from "lucide-react";
import { NOTIFICATION_TYPES, wants } from "@propi/core/notify";
import { unlockedAvatars } from "@propi/core/levels";
import { Avatar, Badge, Button, Card, CardTitle, Field, Flash, Input, KeyInput, PageHeader, Select } from "@/components/app/ui";
import { formatDate } from "@propi/core/i18n";
import { shell } from "@/i18n/app-shell.messages";
import { getLocale } from "@/i18n/locale";
import { profilePage } from "@/i18n/profile.messages";
import { LANGUAGE_NAMES, language } from "@/i18n/language.messages";
import { setMemberLanguageAction } from "@/server/actions/language";
import { chooseAvatarAction, pairingOptInAction, setMilestonesAction, setPreferenceAction } from "@/server/actions/member";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { memberLevel, workspaceView } from "@/server/views";

export async function generateMetadata() {
  return { title: profilePage.t(await getLocale())("title") };
}

const PREFS = new Set(["gift_received", "gift_confirmation", "gift_rejected", "weekly_report", "nudge", "isolation_alert", "adjustment"]);

// S77-S79 level and avatar, S92-S93 milestones and visibility, S95 pairing, S85 notifications.
export default async function Profile({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const p = propi();
  const e = p.engagement;
  const [lvl, w, avatar, milestones, optedIn, prefs, locale, record] = await Promise.all([
    memberLevel(viewer.ws, viewer.memberId),
    workspaceView(viewer.ws),
    e.levels.avatar(viewer.ws, viewer.memberId),
    e.milestones.profile(viewer.ws, viewer.memberId),
    e.pairing.optedIn(viewer.ws),
    p.insights.source.preferences(viewer.ws),
    getLocale(),
    p.ports.directory.member(viewer.ws, viewer.memberId),
  ]);
  const lt = language.t(locale);
  const t = profilePage.t(locale);
  const prefLabel = (type: string) => (PREFS.has(type) ? t(`pref.${type}` as "pref.nudge") : type);
  // Month names in the reader's language (Intl), January = 1.
  const months = Array.from({ length: 12 }, (_, i) => formatDate(locale, Date.UTC(2000, i, 15), { month: "short", timeZone: "UTC" }));
  const { level, config } = lvl;
  const unlocked = new Set(unlockedAvatars(level.level, config.avatars).map((a) => a.id));
  const mine = prefs.get(viewer.memberId);
  const paired = optedIn.includes(viewer.memberId);
  // Same name and picture as the app frame: the stored Slack profile first, then the sign-in session.
  const label = w.members.find((m) => m.id === viewer.memberId)?.displayName ?? viewer.session.name ?? w.label(viewer.memberId);
  const chosen = config.avatars.find((a) => a.id === avatar);

  return (
    <>
      <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="bg-sunflower-soft">
          <div className="flex items-center gap-4">
            <Avatar id={viewer.memberId} label={label} src={chosen?.image ?? w.avatar(viewer.memberId) ?? viewer.session.picture} size="lg" />
            <div>
              <h2 className="font-display text-2xl font-black">{label}</h2>
              <p className="text-sm text-ink-soft">{shell.t(locale)(`role.${viewer.role}`)}</p>
            </div>
          </div>
          <div className="mt-6 rounded-3xl border-2 border-ink bg-white p-5 shadow-sticker">
            <p className="text-sm font-semibold text-ink-soft">{t("level", { level: level.level })}</p>
            <p className="font-display text-3xl font-black">{level.title}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {t("points", { points: level.points })}
              {level.next ? t("toNext", { points: level.next.min - level.points, title: level.next.title }) : ""}
            </p>
          </div>
          <ol className="mt-5 space-y-1.5">
            {config.table.map((l) => (
              <li key={l.level} className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-sm ${l.level === level.level ? "bg-white font-bold" : "text-ink-soft"}`}>
                <span>
                  {l.level}. {l.title}
                </span>
                <span>{l.min}+</span>
              </li>
            ))}
          </ol>
        </Card>

        <div className="grid gap-5">
          {config.avatars.length > 0 ? (
            <Card>
              <CardTitle>{t("avatar")}</CardTitle>
              <div className="flex flex-wrap gap-3">
                {config.avatars.map((a) => (
                  <form key={a.id} action={chooseAvatarAction}>
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="avatarId" value={a.id} />
                    <button disabled={!unlocked.has(a.id)} className={`relative grid w-24 place-items-center gap-1 rounded-2xl border-2 p-2 text-xs font-semibold ${avatar === a.id ? "border-ink bg-coral-soft" : "border-line bg-white"} disabled:opacity-50`}>
                      {a.image ? <img src={a.image} alt="" className="size-12 rounded-full" /> : <Avatar id={a.id} label={a.name} />}
                      {a.name}
                      {!unlocked.has(a.id) ? (
                        <span className="inline-flex items-center gap-1 text-ink-soft">
                          <Lock className="size-3" /> L{a.minLevel}
                        </span>
                      ) : null}
                    </button>
                  </form>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardTitle>{t("milestones")}</CardTitle>
            <form action={setMilestonesAction} className="grid gap-3 sm:grid-cols-2">
              <KeyInput value={formKey()} />
              <Field label={t("birthday")}>
                <div className="flex gap-2">
                  <Select name="birthMonth" defaultValue={milestones?.birthday?.month ?? ""} aria-label={t("birthMonth")}>
                    <option value="">{t("month")}</option>
                    {months.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </Select>
                  <Input name="birthDay" type="number" min={1} max={31} defaultValue={milestones?.birthday?.day ?? ""} placeholder={t("day")} aria-label={t("birthDay")} />
                </div>
              </Field>
              <Field label={t("startDate")}>
                <Input name="startDate" type="date" defaultValue={milestones?.startDate ?? ""} />
              </Field>
              <Field label={t("celebrate")} className="sm:col-span-2">
                <Select name="visibility" defaultValue={milestones?.visibility ?? "public"}>
                  <option value="public">{t("celebrate.public")}</option>
                  <option value="private">{t("celebrate.private")}</option>
                  <option value="none">{t("celebrate.none")}</option>
                </Select>
              </Field>
              <Button className="justify-self-start">{t("saveMilestones")}</Button>
            </form>
          </Card>

          <Card>
            <CardTitle action={<Badge tone={paired ? "mint" : "muted"}>{paired ? t("optedIn") : t("optedOut")}</Badge>}>{t("pairing")}</CardTitle>
            <p className="text-sm text-ink-soft">{t("pairingBody")}</p>
            <form action={pairingOptInAction} className="mt-3">
              <KeyInput value={formKey()} />
              <input type="hidden" name="optedIn" value={paired ? "false" : "true"} />
              <Button tone={paired ? "cream" : "mint"} size="sm">{paired ? t("optOut") : t("optIn")}</Button>
            </form>
          </Card>

          <Card>
            <CardTitle>{lt("profile.title")}</CardTitle>
            <form action={setMemberLanguageAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label={lt("profile.field")} hint={lt("profile.hint")}>
                <Select name="language" defaultValue={record?.language ?? "auto"}>
                  <option value="auto">{lt("profile.auto")}</option>
                  <option value="es" lang="es">{LANGUAGE_NAMES.es}</option>
                  <option value="en" lang="en">{LANGUAGE_NAMES.en}</option>
                </Select>
              </Field>
              <Button className="justify-self-start">{lt("profile.save")}</Button>
            </form>
          </Card>

          <Card>
            <CardTitle>{t("notifications")}</CardTitle>
            <ul className="divide-y divide-line">
              {NOTIFICATION_TYPES.filter((n) => n !== "isolation_alert" || viewer.role === "admin").map((n) => {
                const on = wants(mine, n);
                return (
                  <li key={n} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm font-medium">{prefLabel(n)}</span>
                    <form action={setPreferenceAction}>
                      <input type="hidden" name="type" value={n} />
                      <input type="hidden" name="on" value={on ? "false" : "true"} />
                      <button role="switch" aria-checked={on} aria-label={prefLabel(n)} className="grid min-h-11 min-w-14 place-items-center">
                        <span className={`relative block h-7 w-12 rounded-full border-2 border-ink transition-colors ${on ? "bg-mint" : "bg-cream-deep"}`}>
                          <span className={`absolute top-0.5 left-0.5 size-5 rounded-full border-2 border-ink bg-white transition-transform duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${on ? "translate-x-5" : ""}`} />
                        </span>
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
