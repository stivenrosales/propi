"use client";
// The one button for every form. Inside a form it disables itself while the server action runs,
// so a slow ledger write cannot be sent twice. With `confirm`, the first click arms it and asks
// again inline; the second click within a few seconds submits. Used for destructive actions.
import { useEffect, useState, type ComponentProps, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cx } from "@/lib/cx";
import { toneClass, type Tone } from "./tones";

const ARM_MS = 4000;

export function Button({
  tone = "coral",
  size = "md",
  confirm,
  className,
  children,
  onClick,
  disabled,
  ...props
}: ComponentProps<"button"> & { tone?: Tone; size?: "sm" | "md"; confirm?: string }) {
  const { pending } = useFormStatus();
  const [armed, setArmed] = useState(false);
  const submits = (props.type ?? "submit") === "submit";
  const busy = submits && pending;

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (confirm && !armed) {
      e.preventDefault();
      setArmed(true);
      return;
    }
    setArmed(false);
    onClick?.(e);
  }

  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={handleClick}
      className={cx(
        "lift inline-flex items-center justify-center gap-2 rounded-full border-2 border-ink font-display font-extrabold tracking-tight shadow-sticker disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "min-h-11 px-4 text-sm md:min-h-9 md:px-3.5" : "min-h-11 px-5 text-base",
        toneClass[armed ? "danger" : tone],
        armed && "bg-coral-soft",
        className,
      )}
    >
      {busy ? <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : null}
      {armed ? <span role="status">{confirm}</span> : children}
    </button>
  );
}
