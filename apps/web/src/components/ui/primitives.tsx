import type { ComponentProps, ReactNode } from "react";

type Tone = "coral" | "ink" | "cream";

const toneClass: Record<Tone, string> = {
  coral: "bg-coral text-ink",
  ink: "bg-ink text-cream",
  cream: "bg-cream text-ink",
};

/** Chunky, sticker-like link button with a hard ink shadow. */
export function ButtonLink({
  tone = "coral",
  className = "",
  children,
  ...props
}: ComponentProps<"a"> & { tone?: Tone }) {
  return (
    <a
      className={`lift inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full border-2 border-ink px-6 py-3 font-display text-[1.05rem] font-extrabold tracking-tight shadow-chunky ${toneClass[tone]} ${className}`}
      {...props}
    >
      {children}
    </a>
  );
}

/** One brand coin used as the gift emoji in mock Slack messages. */
export function Coin({ className = "size-[1.15em]" }: { className?: string }) {
  return (
    <img
      src="/brand/propi-mark.svg"
      alt=""
      aria-hidden="true"
      className={`inline-block align-[-0.2em] ${className}`}
    />
  );
}

export function Sparkle({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 132 132" aria-hidden="true" className={className} style={style}>
      <path
        fill="currentColor"
        d="M66 0c4 0 6 3 8 10 7 25 20 35 45 39 8 1 12 4 12 8s-4 7-12 8c-25 4-38 14-45 39-2 7-4 10-8 10s-6-3-8-10c-7-25-20-35-45-39-8-1-12-4-12-8s4-7 12-8c25-4 38-14 45-39 2-7 4-10 8-10z"
      />
    </svg>
  );
}

export function GitHubIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function SlackIcon({ className = "size-5" }: { className?: string }) {
  // Monochrome glyph so it never fights the brand palette.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M5.04 15.17a2.53 2.53 0 1 1-2.52-2.53h2.52v2.53Zm1.27 0a2.53 2.53 0 0 1 5.05 0v6.31a2.53 2.53 0 1 1-5.05 0v-6.31ZM8.83 5.04a2.53 2.53 0 1 1 2.53-2.52v2.52H8.83Zm0 1.27a2.53 2.53 0 0 1 0 5.05H2.52a2.53 2.53 0 1 1 0-5.05h6.31Zm10.13 2.52a2.53 2.53 0 1 1 2.52 2.53h-2.52V8.83Zm-1.27 0a2.53 2.53 0 0 1-5.05 0V2.52a2.53 2.53 0 1 1 5.05 0v6.31Zm-2.52 10.13a2.53 2.53 0 1 1-2.53 2.52v-2.52h2.53Zm0-1.27a2.53 2.53 0 0 1 0-5.05h6.31a2.53 2.53 0 1 1 0 5.05h-6.31Z" />
    </svg>
  );
}

/** Small section label, set in the display face. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`inline-flex items-center gap-2 rounded-full border-2 border-current px-3 py-1 font-display text-sm font-extrabold tracking-wide ${className}`}
    >
      {children}
    </p>
  );
}
