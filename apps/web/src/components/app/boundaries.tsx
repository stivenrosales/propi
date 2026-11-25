"use client";
// Branded loading and error states for the member and admin areas.
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse motion-reduce:animate-none">
      <div className="mb-6 h-10 w-56 rounded-2xl bg-cream-deep" />
      <div className="mb-5 h-40 rounded-[2rem] bg-cream-deep" />
      <div className="grid gap-5 md:grid-cols-3">
        <div className="h-36 rounded-[1.75rem] bg-cream-deep" />
        <div className="h-36 rounded-[1.75rem] bg-cream-deep" />
        <div className="h-36 rounded-[1.75rem] bg-cream-deep" />
      </div>
    </div>
  );
}

export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-[2rem] border-2 border-ink bg-white px-6 py-10 text-center shadow-chunky">
      <img src="/brand/mascot-wave.webp" alt="" className="size-24 object-contain" />
      <h1 className="font-display text-2xl font-black tracking-tight">Something went wrong</h1>
      <p className="text-sm text-ink-soft">This page could not load. Your props and balance are safe. Try again in a moment.</p>
      {error.digest ? <p className="font-mono text-xs text-ink-soft">Reference {error.digest}</p> : null}
      <button
        type="button"
        onClick={reset}
        className="lift mt-2 inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-ink bg-coral px-5 font-display font-extrabold shadow-sticker"
      >
        <RotateCcw className="size-4" /> Try again
      </button>
    </div>
  );
}
