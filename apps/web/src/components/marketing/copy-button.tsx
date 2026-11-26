"use client";

import { useState } from "react";

export function CopyButton({ text, labels }: { text: string; labels: { copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-full border-2 border-cream/30 px-3 py-1 text-xs font-semibold text-cream transition-colors hover:border-sunflower hover:text-sunflower"
    >
      <span aria-live="polite">{copied ? labels.copied : labels.copy}</span>
    </button>
  );
}
