import { SlackIcon } from "@/components/ui/primitives";
import { site } from "@/content/site";
import { memberLabel } from "@/lib/format";
import { devLoginEnabled, slackOidc } from "@/server/env";
import { propi } from "@/server/propi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  slack_not_configured: "Sign in with Slack is not configured on this server yet.",
  slack_denied: "Slack sign-in was cancelled.",
  invalid_state: "That sign-in link expired. Please try again.",
  workspace_not_installed: "Propi isn't installed in this Slack workspace yet.",
  install_cancelled: "Adding Propi to Slack was cancelled.",
  install_failed: "Propi could not be added to Slack. Please try again.",
  identity_not_linked: "Your Slack account is not linked to a Propi member yet. Say hi to Propi in Slack first, or ask an admin.",
  inactive_member: "Your Propi membership is deactivated. Ask an admin to reactivate it.",
};

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
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : null;
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
          <h1 className="font-display text-3xl font-black tracking-tight">Welcome back</h1>
          <p className="mt-2 text-ink-soft">Sign in with the Slack account you use with Propi.</p>
          {error ? <p role="alert" className="mt-4 rounded-2xl bg-coral-soft px-4 py-3 text-sm font-semibold">{error}</p> : null}
          {sp.installed ? (
            <p role="status" className="mt-4 rounded-2xl bg-sunflower/40 px-4 py-3 text-sm font-semibold">
              Propi is installed in your Slack workspace. Sign in with Slack to open your dashboard.
            </p>
          ) : null}
          {notInstalled ? (
            <a
              href={slack ? "/slack/install" : undefined}
              aria-disabled={!slack}
              className={`lift mt-6 flex min-h-12 items-center justify-center gap-3 rounded-full border-2 border-ink bg-coral px-6 font-display text-lg font-extrabold text-ink shadow-sticker ${slack ? "" : "pointer-events-none opacity-50"}`}
            >
              <SlackIcon /> Add to Slack
            </a>
          ) : null}
          <a
            href={slack ? "/auth/slack" : undefined}
            aria-disabled={!slack}
            className={`lift mt-6 flex min-h-12 items-center justify-center gap-3 rounded-full border-2 border-ink bg-ink px-6 font-display text-lg font-extrabold text-cream shadow-sticker ${slack ? "" : "pointer-events-none opacity-50"}`}
          >
            <SlackIcon /> Sign in with Slack
          </a>
          {slack && !notInstalled ? (
            <p className="mt-4 text-center text-sm text-ink-soft">
              New to Propi?{" "}
              <a href="/slack/install" className="font-bold text-ink underline underline-offset-4">
                Add it to your Slack workspace
              </a>
            </p>
          ) : null}
          {dev ? (
            <form action="/auth/dev" method="post" className="mt-8 border-t border-dashed border-line pt-6">
              <p className="mb-3 font-display text-sm font-extrabold tracking-wide text-coral-ink uppercase">Dev login</p>
              <input type="hidden" name="next" value={sp.next ?? "/app"} />
              {dev.length === 0 ? (
                <p className="text-sm text-ink-soft">No workspaces yet. Run the demo seed first.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <select name="member" className="min-h-10 rounded-xl border border-line bg-cream/60 px-3" aria-label="Member">
                    {dev.flatMap((d) =>
                      d.members.map((m) => (
                        <option key={`${d.ws}:${m.id}`} value={`${d.ws}::${m.id}`}>
                          {memberLabel(m.id)} ({m.role}) · {d.ws}
                        </option>
                      )),
                    )}
                  </select>
                  <button className="lift min-h-11 rounded-full border-2 border-ink bg-sunflower font-display font-extrabold shadow-sticker">Continue as this member</button>
                </div>
              )}
            </form>
          ) : null}
        </div>
        <p className="mt-6 text-center text-sm text-ink-soft">
          By signing in you agree to the{" "}
          <a href={site.terms} className="font-bold text-ink underline underline-offset-4">
            Terms
          </a>{" "}
          and{" "}
          <a href={site.privacy} className="font-bold text-ink underline underline-offset-4">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </main>
  );
}
