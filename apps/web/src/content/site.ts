export const site = {
  name: "Propi",
  tagline: "Say thanks. Make it count.",
  description:
    "Open-source peer recognition for Slack. Give props with an emoji, keep them in an append-only ledger, and redeem them in your team's shop. Hosted or self-hosted, AGPL-3.0.",
  // Set NEXT_PUBLIC_SITE_URL to the public origin in production.
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  github: "https://github.com/stivenrosales/propi",
  license: "https://github.com/stivenrosales/propi/blob/main/LICENSE",
  installHref: "/slack/install",
} as const;
