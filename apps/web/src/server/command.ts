// Shared plumbing for server actions: the command envelope and the post-redirect-get flash.
import { redirect } from "next/navigation";
import { uuidv7 } from "@propi/db";
import type { CommandBase, CommandKey, Instant, Locale } from "@propi/core";
import { errorMessage } from "@/lib/format";
import type { Viewer } from "./auth";

/** A fresh key for one rendered form. */
export const formKey = (): string => uuidv7();

const FORM_KEY = /^[0-9a-f-]{16,64}$/i;

/**
 * The command envelope for a web write. The key is `web:<member>:<form key>`, so submitting the same
 * rendered form twice replays the first result instead of writing again (S17, G2).
 */
export function envelope(viewer: Viewer, form: FormData): CommandBase {
  const k = String(form.get("key") ?? "");
  if (!FORM_KEY.test(k)) throw new Error("missing form key");
  return { key: `web:${viewer.memberId}:${k}` as CommandKey, workspaceId: viewer.ws, actor: viewer.actor, at: Date.now() as Instant };
}

/** Derived keys for actions that send several commands from one form. */
export const subKey = (base: CommandBase, suffix: string): CommandBase => ({ ...base, key: `${base.key}:${suffix}` as CommandKey });

type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: { readonly code: string } };

/** Post/redirect/get: back to `path` with the outcome in the query string, in the reader's language. */
export function finish(path: string, outcome: Outcome, okText: string, locale: Locale): never {
  const sep = path.includes("?") ? "&" : "?";
  if (outcome.ok) redirect(`${path}${sep}ok=${encodeURIComponent(okText)}`);
  redirect(`${path}${sep}error=${encodeURIComponent(errorMessage(locale, outcome.error as never))}`);
}

export const fail = (code: string, extra: Record<string, unknown> = {}): Outcome => ({ ok: false, error: { code, ...extra } });

export function str(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export function optStr(form: FormData, name: string): string | null {
  const v = str(form, name);
  return v === "" ? null : v;
}

/** An integer field; NaN when absent or not an integer (core rejects it with its own error). */
export function int(form: FormData, name: string): number {
  const v = str(form, name);
  return /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
}

export function optInt(form: FormData, name: string): number | null {
  return str(form, name) === "" ? null : int(form, name);
}

export const bool = (form: FormData, name: string): boolean => form.get(name) === "on" || form.get(name) === "true";
