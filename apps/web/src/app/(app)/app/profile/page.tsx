import { Lock } from "lucide-react";
import { NOTIFICATION_TYPES, wants } from "@propi/core/notify";
import { unlockedAvatars } from "@propi/core/levels";
import { Avatar, Badge, Button, Card, CardTitle, Field, Flash, Input, KeyInput, PageHeader, Select } from "@/components/app/ui";
import { getLocale } from "@/i18n/locale";
import { LANGUAGE_NAMES, language } from "@/i18n/language.messages";
import { setMemberLanguageAction } from "@/server/actions/language";
import { chooseAvatarAction, pairingOptInAction, setMilestonesAction, setPreferenceAction } from "@/server/actions/member";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { memberLevel, workspaceView } from "@/server/views";

export const metadata = { title: "Profile" };

const PREF_LABEL: Record<string, string> = {
  gift_received: "When someone gives me props",
  gift_confirmation: "Confirmation after I give",
  gift_rejected: "When a gift could not go through",
  weekly_report: "Weekly report",
  nudge: "Friday nudge to give",
  isolation_alert: "Isolation alerts (admins)",
  adjustment: "Admin adjustments to my balance",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  const { level, config } = lvl;
  const unlocked = new Set(unlockedAvatars(level.level, config.avatars).map((a) => a.id));
  const mine = prefs.get(viewer.memberId);
  const paired = optedIn.includes(viewer.memberId);
  // Same name and picture as the app frame: the stored Slack profile first, then the sign-in session.
  const label = w.members.find((m) => m.id === viewer.memberId)?.displayName ?? viewer.session.name ?? w.label(viewer.memberId);
  const chosen = config.avatars.find((a) => a.id === avatar);

  return (
    <>
      <PageHeader title="Profile" eyebrow="You" />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="bg-sunflower-soft">
          <div className="flex items-center gap-4">
            <Avatar id={viewer.memberId} label={label} src={chosen?.image ?? w.avatar(viewer.memberId) ?? viewer.session.picture} size="lg" />
            <div>
              <h2 className="font-display text-2xl font-black">{label}</h2>
              <p className="text-sm text-ink-soft capitalize">{viewer.role}</p>
            </div>
          </div>
          <div className="mt-6 rounded-3xl border-2 border-ink bg-white p-5 shadow-sticker">
            <p className="text-sm font-semibold text-ink-soft">Level {level.level}</p>
            <p className="font-display text-3xl font-black">{level.title}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {level.points} points (received + given){level.next ? ` · ${level.next.min - level.points} to ${level.next.title}` : ""}
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
              <CardTitle>Avatar</CardTitle>
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
            <CardTitle>Milestones</CardTitle>
            <form action={setMilestonesAction} className="grid gap-3 sm:grid-cols-2">
              <KeyInput value={formKey()} />
              <Field label="Birthday">
                <div className="flex gap-2">
                  <Select name="birthMonth" defaultValue={milestones?.birthday?.month ?? ""} aria-label="Birth month">
                    <option value="">Month</option>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </Select>
                  <Input name="birthDay" type="number" min={1} max={31} defaultValue={milestones?.birthday?.day ?? ""} placeholder="Day" aria-label="Birth day" />
                </div>
              </Field>
              <Field label="Start date">
                <Input name="startDate" type="date" defaultValue={milestones?.startDate ?? ""} />
              </Field>
              <Field label="How should we celebrate?" className="sm:col-span-2">
                <Select name="visibility" defaultValue={milestones?.visibility ?? "public"}>
                  <option value="public">Post in the team channel</option>
                  <option value="private">Just a private message</option>
                  <option value="none">Don&apos;t celebrate</option>
                </Select>
              </Field>
              <Button className="justify-self-start">Save milestones</Button>
            </form>
          </Card>

          <Card>
            <CardTitle action={<Badge tone={paired ? "mint" : "muted"}>{paired ? "Opted in" : "Opted out"}</Badge>}>Pairing chats</CardTitle>
            <p className="text-sm text-ink-soft">Get paired with a teammate you rarely exchange props with, for a short chat.</p>
            <form action={pairingOptInAction} className="mt-3">
              <KeyInput value={formKey()} />
              <input type="hidden" name="optedIn" value={paired ? "false" : "true"} />
              <Button tone={paired ? "cream" : "mint"} size="sm">{paired ? "Opt out" : "Opt in"}</Button>
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
            <CardTitle>Notifications</CardTitle>
            <ul className="divide-y divide-line">
              {NOTIFICATION_TYPES.filter((t) => t !== "isolation_alert" || viewer.role === "admin").map((t) => {
                const on = wants(mine, t);
                return (
                  <li key={t} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm font-medium">{PREF_LABEL[t] ?? t}</span>
                    <form action={setPreferenceAction}>
                      <input type="hidden" name="type" value={t} />
                      <input type="hidden" name="on" value={on ? "false" : "true"} />
                      <button role="switch" aria-checked={on} aria-label={PREF_LABEL[t] ?? t} className="grid min-h-11 min-w-14 place-items-center">
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
