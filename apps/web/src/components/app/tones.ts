// Button tones shared by the client Button and the server LinkButton. Kept out of the
// "use client" module so server components can read the class map.
export type Tone = "coral" | "ink" | "cream" | "mint" | "danger";
export const toneClass: Record<Tone, string> = {
  coral: "bg-coral text-ink",
  ink: "bg-ink text-cream",
  cream: "bg-cream text-ink",
  mint: "bg-mint text-ink",
  danger: "bg-white text-coral-ink",
};
