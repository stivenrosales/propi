// shadcn-style primitives for the member and admin areas, in the Propi brand (brand/README.md):
// cream paper, white cards, ink type, coral actions, sunflower celebration, mint success.
import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { initials, memberHue } from "@/lib/format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function PageHeader({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="font-display text-sm font-extrabold tracking-wide text-coral uppercase">{eyebrow}</p> : null}
        <h1 className="font-display text-3xl font-black tracking-tight text-ink md:text-4xl">{title}</h1>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cx("min-w-0 rounded-[1.75rem] border border-line bg-white p-5 shadow-[0_1px_0_0_var(--line),0_18px_40px_-28px_rgb(29_26_51/0.35)] md:p-6", className)} {...props}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  );
}

type Tone = "coral" | "ink" | "cream" | "mint" | "danger";
const toneClass: Record<Tone, string> = {
  coral: "bg-coral text-ink",
  ink: "bg-ink text-cream",
  cream: "bg-cream text-ink",
  mint: "bg-mint text-ink",
  danger: "bg-white text-coral",
};

export function Button({ tone = "coral", size = "md", className, ...props }: ComponentProps<"button"> & { tone?: Tone; size?: "sm" | "md" }) {
  return (
    <button
      className={cx(
        "lift inline-flex items-center justify-center gap-2 rounded-full border-2 border-ink font-display font-extrabold tracking-tight shadow-sticker disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "min-h-9 px-3.5 text-sm" : "min-h-11 px-5 text-base",
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({ tone = "cream", className, ...props }: ComponentProps<"a"> & { tone?: Tone }) {
  return <a className={cx("lift inline-flex min-h-10 items-center justify-center gap-2 rounded-full border-2 border-ink px-4 font-display text-sm font-extrabold shadow-sticker", toneClass[tone], className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
}

const inputClass = "min-h-10 w-full rounded-xl border border-line bg-cream/60 px-3 py-2 text-ink placeholder:text-ink-soft/70 focus:border-ink focus:bg-white focus:outline-none";

export const Input = ({ className, ...p }: ComponentProps<"input">) => <input className={cx(inputClass, className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => <textarea className={cx(inputClass, "min-h-20", className)} {...p} />;
export const Select = ({ className, ...p }: ComponentProps<"select">) => <select className={cx(inputClass, className)} {...p} />;

export function Checkbox({ label, ...p }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-medium text-ink">
      <input type="checkbox" className="size-4 rounded accent-coral" {...p} />
      {label}
    </label>
  );
}

/** The command key for one rendered form: a double submit replays instead of writing twice (S17). */
export const KeyInput = ({ value }: { value: string }) => <input type="hidden" name="key" value={value} />;

type BadgeTone = "coral" | "sunflower" | "mint" | "ink" | "muted";
const badgeClass: Record<BadgeTone, string> = {
  coral: "bg-coral-soft text-ink",
  sunflower: "bg-sunflower-soft text-ink",
  mint: "bg-mint-soft text-ink",
  ink: "bg-ink text-cream",
  muted: "bg-cream-deep text-ink-soft",
};

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap", badgeClass[tone])}>{children}</span>;
}

export function Coin({ className = "size-[1.1em]" }: { className?: string }) {
  return <img src="/brand/propi-mark.svg" alt="" aria-hidden="true" className={cx("inline-block shrink-0 align-[-0.18em]", className)} />;
}

/** A number of units with the brand token. */
export function Units({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 font-display font-extrabold tabular-nums", className)}>
      <Coin />
      {n.toLocaleString("en-US")}
    </span>
  );
}

export function Avatar({ id, label, src, size = "md" }: { id: string; label: string; src?: string | null; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "size-8 text-xs" : size === "lg" ? "size-16 text-xl" : "size-10 text-sm";
  if (src) return <img src={src} alt="" className={cx("shrink-0 rounded-full border-2 border-white object-cover shadow", dim)} />;
  const hue = memberHue(id);
  return (
    <span aria-hidden="true" className={cx("inline-grid shrink-0 place-items-center rounded-full border-2 border-white font-display font-black text-ink shadow", dim)} style={{ background: hue }}>
      {initials(label)}
    </span>
  );
}

export function Stat({ label, value, sub, tone = "white" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "white" | "coral" | "sunflower" | "mint" }) {
  const bg = { white: "bg-white", coral: "bg-coral-soft", sunflower: "bg-sunflower-soft", mint: "bg-mint-soft" }[tone];
  return (
    <div className={cx("rounded-3xl border border-line p-5", bg)}>
      <p className="text-sm font-semibold text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-3xl font-black tracking-tight text-ink">{value}</p>
      {sub ? <p className="mt-1 text-sm text-ink-soft">{sub}</p> : null}
    </div>
  );
}

export function Empty({ title, children, art = "/brand/mascot-wave.webp" }: { title: string; children?: ReactNode; art?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-line bg-cream/50 px-6 py-10 text-center">
      <img src={art} alt="" className="size-20 object-contain" />
      <p className="font-display text-lg font-extrabold text-ink">{title}</p>
      {children ? <div className="max-w-sm text-sm text-ink-soft">{children}</div> : null}
    </div>
  );
}

/** Shows the outcome of the last server action (`?ok=` / `?error=` in the URL). */
export function Flash({ ok, error }: { ok?: string | undefined; error?: string | undefined }) {
  if (!ok && !error) return null;
  const good = !error;
  return (
    <div role="status" className={cx("mb-5 flex items-start gap-3 rounded-2xl border-2 border-ink px-4 py-3 shadow-sticker", good ? "bg-mint-soft" : "bg-coral-soft")}>
      {good ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-ink" /> : <CircleAlert className="mt-0.5 size-5 shrink-0 text-ink" />}
      <p className="text-sm font-semibold text-ink">{good ? ok : error}</p>
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto md:-mx-6">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-bold tracking-wide text-ink-soft uppercase">
            {head.map((h, i) => (
              <th key={i} className="px-5 py-2.5 first:pl-5 md:px-6">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const Td = ({ className, ...p }: ComponentProps<"td">) => <td className={cx("px-5 py-3 align-middle md:px-6", className)} {...p} />;
