import type { Metadata } from "next";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { rich } from "@/components/marketing/rich-text";
import { SlackIcon } from "@/components/ui/primitives";
import { site } from "@/content/site";
import { memberLabel } from "@/lib/format";
import { devLoginEnabled, slackOidc } from "@/server/env";
import { propi } from "@/server/propi";
import { getLocale } from "@/i18n/locale";
import { SIGNIN_ERRORS, signin } from "@/i18n/signin.messages";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: signin.t(await getLocale())("meta.title") };
}

const isSigninError = (code: string): code is (typeof SIGNIN_ERRORS)[number] => (SIGNIN_ERRORS as readonly string[]).includes(code);


async function devMembers() {
  const p = propi();
  const workspaces = await p.prisma.workspace.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  const out: { ws: string; members: { id: string; role: string }[] }[] = [];
  for (const w of workspaces.slice(0, 10)) {
    const members = await p.ports.directory.members(w.id as never);
    out.push({ ws: w.id, members: members.filter((m) => m.active).map((m) => ({ id: m.id, role: m.role })) });
  }
  return out;
}

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const slack = slackOidc() !== null;
  const dev = devLoginEnabled() ? await devMembers() : null;
  const t = signin.t(await getLocale());
  const error = sp.error ? (isSigninError(sp.error) ? t(`error.${sp.error}`) : t("error.unknown")) : null;
  // S5: a team without an installation is offered the install right here.
  const notInstalled = sp.error === "workspace_not_installed";
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <a href="/" className="mx-auto mb-8 block w-fit">
          <img src="/brand/propi-logo.svg" alt="Propi" className="h-11 w-auto" />
        </a>
        <div className="relative rounded-[2rem] border-2 border-ink bg-white p-7 shadow-chunky">
          <img src="/brand/mascot-wave.webp" alt="" className="bob absolute -top-14 right-2 w-24 sm:-right-6" />
          <h1 className="font-display text-3xl font-black tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-ink-soft">{t("lead")}</p>
          {error ? <p role="alert" className="mt-4 rounded-2xl bg-coral-soft px-4 py-3 text-sm font-semibold">{error}</p> : null}
          {sp.installed ? (
            <p role="status" className="mt-4 rounded-2xl bg-sunflower/40 px-4 py-3 text-sm font-semibold">
              {t("installed")}
            </p>
          ) : null}
          {notInstalled ? (
            <a
              href={slack ? "/slack/install" : undefined}
              aria-disabled={!slack}
              className={`lift mt-6 flex min-h-12 items-center justify-center gap-3 rounded-full border-2 border-ink bg-coral px-6 font-display text-lg font-extrabold text-ink shadow-sticker ${slack ? "" : "pointer-events-none opacity-50"}`}
            >
              <SlackIcon /> {t("addToSlack")}
            </a>
          ) : null}
          <a
            href={slack ? "/auth/slack" : undefined}
            aria-disabled={!slack}
            className={`lift mt-6 flex min-h-12 items-center justify-center gap-3 rounded-full border-2 border-ink bg-ink px-6 font-display text-lg font-extrabold text-cream shadow-sticker ${slack ? "" : "pointer-events-none opacity-50"}`}
          >
            <SlackIcon /> {t("signInWithSlack")}
          </a>
          {slack && !notInstalled ? (
            <p className="mt-4 text-center text-sm text-ink-soft">
              {t("newPrompt")}{" "}
              <a href="/slack/install" className="font-bold text-ink underline underline-offset-4">
                {t("newLink")}
              </a>
            </p>
          ) : null}
          {dev ? (
            <form action="/auth/dev" method="post" className="mt-8 border-t border-dashed border-line pt-6">
              <p className="mb-3 font-display text-sm font-extrabold tracking-wide text-coral-ink uppercase">{t("dev.title")}</p>
              <input type="hidden" name="next" value={sp.next ?? "/app"} />
              {dev.length === 0 ? (
                <p className="text-sm text-ink-soft">{t("dev.empty")}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <select name="member" className="min-h-10 rounded-xl border border-line bg-cream/60 px-3" aria-label={t("dev.member")}>
                    {dev.flatMap((d) =>
                      d.members.map((m) => (
                        <option key={`${d.ws}:${m.id}`} value={`${d.ws}::${m.id}`}>
                          {memberLabel(m.id)} ({m.role}) · {d.ws}
                        </option>
                      )),
                    )}
                  </select>
                  <button className="lift min-h-11 rounded-full border-2 border-ink bg-sunflower font-display font-extrabold shadow-sticker">{t("dev.continue")}</button>
                </div>
              )}
            </form>
          ) : null}
        </div>
        <div className="mt-6 flex justify-center">
          <LocaleSwitcher />
        </div>
        <p className="mt-4 text-center text-sm text-ink-soft">
          {rich(t("agree", { terms: "{terms}", privacy: "{privacy}" }), {
            terms: (
              <a href={site.terms} className="font-bold text-ink underline underline-offset-4">
                {t("agree.terms")}
              </a>
            ),
            privacy: (
              <a href={site.privacy} className="font-bold text-ink underline underline-offset-4">
                {t("agree.privacy")}
              </a>
            ),
          })}
        </p>
      </div>
    </main>
  );
}
