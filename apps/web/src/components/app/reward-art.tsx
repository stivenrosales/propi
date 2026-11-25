// The tile art for a reward: its image when it has one, else a category glyph on a brand tint
// (the dashboard direction in brand/kie/ui-moodboard.png).
import { BookOpen, Coffee, Gift, Palmtree, Shirt, Sparkles, Sticker, Ticket, UtensilsCrossed } from "lucide-react";

const TINTS = ["bg-coral-soft", "bg-mint-soft", "bg-sunflower-soft"];

function glyph(categories: readonly string[], title: string) {
  const t = `${categories.join(" ")} ${title}`.toLowerCase();
  const c = "size-14 stroke-[1.6]";
  if (/sticker/.test(t)) return <Sticker className={`${c} text-coral`} />;
  if (/swag|hoodie|shirt|merch/.test(t)) return <Shirt className={`${c} text-mint`} />;
  if (/book|learn|course/.test(t)) return <BookOpen className={`${c} text-coral`} />;
  if (/coffee/.test(t)) return <Coffee className={`${c} text-ink`} />;
  if (/lunch|dinner|pizza|food/.test(t)) return <UtensilsCrossed className={`${c} text-coral`} />;
  if (/time off|day off|holiday/.test(t)) return <Palmtree className={`${c} text-mint`} />;
  if (/experience|ticket/.test(t)) return <Ticket className={`${c} text-sunflower`} />;
  if (/gift/.test(t)) return <Gift className={`${c} text-coral`} />;
  return <Sparkles className={`${c} text-sunflower`} />;
}

export function RewardArt({ id, image, categories, title, className = "h-36" }: { id: string; image: string | null; categories: readonly string[]; title: string; className?: string }) {
  let h = 0;
  for (const ch of id) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  if (image) return <img src={image} alt="" loading="lazy" className={`w-full rounded-2xl object-cover ${className}`} />;
  return <div className={`grid w-full place-items-center rounded-2xl ${TINTS[h % TINTS.length]} ${className}`}>{glyph(categories, title)}</div>;
}
