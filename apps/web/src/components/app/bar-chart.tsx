// A small bar chart in the brand palette (brand/kie/ui-moodboard.png), plain SVG, no client JS.
const COLORS = ["var(--coral)", "var(--sunflower)", "var(--mint)"];

export function BarChart({ data, label }: { data: readonly { day: string; units: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.units));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-44 w-full" role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = (Math.max(0, d.units) / max) * 36;
          return (
            <rect key={d.day} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} rx={0.9} fill={COLORS[i % COLORS.length]} opacity={0.9}>
              <title>{`${d.day}: ${d.units}`}</title>
            </rect>
          );
        })}
        <line x1="0" y1="39.85" x2="100" y2="39.85" stroke="var(--line)" strokeWidth="0.3" />
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-ink-soft">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </figcaption>
    </figure>
  );
}
