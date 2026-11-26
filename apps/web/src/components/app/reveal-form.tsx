"use client";
// A form whose server action returns a secret exactly once (S98 token plaintext, S99 webhook secret).
// The secret only lives in this component's state: it is never put in a URL, a cookie or the page HTML
// that is rendered again later.
import { useActionState, useState, type ReactNode } from "react";
import { Copy, KeyRound } from "lucide-react";
import { shell } from "@/i18n/app-shell.messages";
import type { RevealState } from "@/server/actions/admin";
import { useLocale } from "./locale-context";

const EMPTY: RevealState = { secret: null, label: null, error: null };

export function RevealForm({ action, children, submit, note }: { action: (prev: RevealState, form: FormData) => Promise<RevealState>; children: ReactNode; submit: string; note: string }) {
  const [state, run, pending] = useActionState(action, EMPTY);
  const [copied, setCopied] = useState(false);
  const t = shell.t(useLocale());
  return (
    <div>
      <form action={run} className="grid gap-3 sm:grid-cols-2">
        {children}
        <button disabled={pending} className="lift inline-flex min-h-11 items-center justify-center gap-2 justify-self-start rounded-full border-2 border-ink bg-coral px-5 font-display font-extrabold shadow-sticker disabled:opacity-50 sm:col-span-2">
          <KeyRound className="size-4" /> {pending ? t("reveal.working") : submit}
        </button>
      </form>
      {state.error ? <p role="alert" className="mt-3 rounded-2xl bg-coral-soft px-4 py-2 text-sm font-semibold">{state.error}</p> : null}
      {state.secret ? (
        <div role="status" className="mt-4 rounded-3xl border-2 border-ink bg-sunflower-soft p-4 shadow-sticker">
          <p className="text-sm font-bold">{t("reveal.copyNow", { label: state.label ?? "" })} {note}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-white px-3 py-2 font-mono text-xs whitespace-nowrap">{state.secret}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(state.secret ?? "").then(() => setCopied(true))}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border-2 border-ink bg-white px-3 text-sm font-bold"
            >
              <Copy className="size-4" /> {copied ? t("reveal.copied") : t("reveal.copy")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
