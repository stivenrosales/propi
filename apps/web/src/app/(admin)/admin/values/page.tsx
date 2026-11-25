import { Button, Card, Flash, Input, PageHeader } from "@/components/app/ui";
import { saveValuesAction } from "@/server/actions/admin";
import { requireViewer } from "@/server/auth";
import { propi } from "@/server/propi";

export const metadata = { title: "Values" };

// S41: the workspace values, each with a name, an optional hashtag and an optional emoji.
export default async function Values({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer("admin");
  const sp = await searchParams;
  const values = await propi().ports.directory.values(viewer.ws);
  const rows = [...values, { id: "", name: "", hashtag: null, emoji: null }, { id: "", name: "", hashtag: null, emoji: null }];
  return (
    <>
      <PageHeader title="Values" eyebrow="Admin" />
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="max-w-3xl">
        <p className="mb-4 text-sm text-ink-soft">A gift is tagged with a value when its message has the hashtag or the emoji. Clear a name to remove a value; past gifts keep their tags.</p>
        <form action={saveValuesAction} className="grid gap-3">
          <div className="hidden grid-cols-3 gap-3 text-xs font-bold tracking-wide text-ink-soft uppercase sm:grid">
            <span>Name</span>
            <span>Hashtag</span>
            <span>Emoji</span>
          </div>
          {rows.map((v, i) => (
            <div key={v.id || `new-${i}`} className="grid gap-2 rounded-2xl bg-cream/50 p-2 sm:grid-cols-3 sm:bg-transparent sm:p-0">
              <input type="hidden" name="id" value={v.id} />
              <Input name="name" defaultValue={v.name} placeholder={v.id ? "" : "New value"} aria-label="Name" />
              <Input name="hashtag" defaultValue={v.hashtag ?? ""} placeholder="#ownership" aria-label="Hashtag" />
              <Input name="emoji" defaultValue={v.emoji ?? ""} placeholder=":muscle:" aria-label="Emoji" />
            </div>
          ))}
          <Button className="justify-self-start">Save values</Button>
        </form>
      </Card>
    </>
  );
}
