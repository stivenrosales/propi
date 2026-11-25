import { Handshake } from "lucide-react";
import { StateBadge } from "@/components/app/state-badge";
import { Avatar, Button, Card, Empty, Flash, Input, KeyInput, PageHeader, Units } from "@/components/app/ui";
import { formatDate } from "@/lib/format";
import { contributeAction } from "@/server/actions/member";
import { requireViewer } from "@/server/auth";
import { formKey } from "@/server/command";
import { propi } from "@/server/propi";
import { collabs, workspaceView } from "@/server/views";

export const metadata = { title: "Group rewards" };

// S56-S59: pool props toward a shared reward; progress is visible to everyone.
export default async function Collabs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const [list, w, balances] = await Promise.all([collabs(viewer.ws), workspaceView(viewer.ws), propi().app.balances(viewer.ws, viewer.memberId)]);
  return (
    <>
      <PageHeader title="Group rewards" eyebrow="Better together">
        <div className="rounded-full border-2 border-ink bg-white px-4 py-2 shadow-sticker">
          <Units n={balances.redeemable} />
        </div>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      {list.length === 0 ? (
        <Empty title="No group rewards yet">Admins can start one, and everyone can chip in.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {list.map(({ collab, progress }) => {
            const pct = Math.min(100, Math.round((progress.raised / progress.goal) * 100));
            const mine = progress.contributors.find((c) => c.memberId === viewer.memberId)?.amount ?? 0;
            return (
              <Card key={collab.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 place-items-center rounded-2xl bg-sunflower-soft">
                      <Handshake className="size-6" />
                    </span>
                    <div>
                      <h2 className="font-display text-xl font-extrabold">{collab.title}</h2>
                      <p className="text-sm text-ink-soft">{collab.deadline ? `Until ${formatDate(collab.deadline, w.settings.timezone)}` : "No deadline"}</p>
                    </div>
                  </div>
                  <StateBadge state={collab.phase} />
                </div>
                <p className="mt-3 text-sm text-ink-soft">{collab.description}</p>
                <div className="mt-4 flex items-end justify-between">
                  <Units n={progress.raised} className="text-2xl" />
                  <span className="text-sm font-semibold text-ink-soft">of {progress.goal} · {pct}%</span>
                </div>
                <div className="mt-2 h-4 overflow-hidden rounded-full border-2 border-ink bg-cream" role="progressbar" aria-valuenow={progress.raised} aria-valuemin={0} aria-valuemax={progress.goal}>
                  <div className="h-full bg-coral" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {progress.contributors.slice(0, 6).map((c) => (
                      <Avatar key={c.memberId} id={c.memberId} label={w.label(c.memberId)} src={w.avatar(c.memberId)} size="sm" />
                    ))}
                  </div>
                  <span className="text-sm text-ink-soft">{progress.contributors.length} contributors{mine > 0 ? ` · you gave ${mine}` : ""}</span>
                </div>
                {collab.phase === "open" ? (
                  <form action={contributeAction} className="mt-5 flex gap-2">
                    <KeyInput value={formKey()} />
                    <input type="hidden" name="collabId" value={collab.id} />
                    <Input name="amount" type="number" min={1} required placeholder="Amount" aria-label="Amount to contribute" className="max-w-36" />
                    <Button>Chip in</Button>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
