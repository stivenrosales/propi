# Propi brand kit

Propi sounds like *props* (recognition, in English slang) and *propina* (a tip: the little extra you give out of gratitude, in Spanish). The tone is warm, playful and team-first.

## Logo

| File | Use |
|---|---|
| `logo/propi-logo.svg` | Primary lockup on light backgrounds |
| `logo/propi-logo-on-dark.svg` | Lockup on ink or dark backgrounds |
| `logo/propi-mark.svg` | Symbol only: favicon, app icon, avatar of the Slack bot |

The symbol is a coral token with a bold "p" and a sunflower sparkle. Keep clear space of at least the sparkle's height around it. Never recolor the token.

## Color

| Token | Hex | Use |
|---|---|---|
| `coral` | `#FF5A3C` | Primary: tokens, primary buttons, highlights |
| `ink` | `#1D1A33` | Text, wordmark, dark surfaces |
| `cream` | `#FFF6EC` | Page background |
| `sunflower` | `#FFC83D` | Celebration accents, sparkles, badges |
| `mint` | `#2EC4A0` | Success, delivered redemptions |

## Type

- Display: a heavy rounded geometric sans (web: **Nunito** 800/900, Google Fonts).
- UI and body: **Inter**.

## Illustration and mascot

- Flat shapes, chunky rounded forms, light grain, palette only.
- Mascot: a round coral coin with dot eyes and sunflower cheeks (`kie/mascot.png`, four poses on a transparent background).
- References: `kie/hero.png` (landing hero), `kie/ui-moodboard.png` (dashboard direction).

## How these were made

Generated with Kie.ai GPT Image 2.6 (Flare): logos as native SVG, the rest as PNG. Prompts are in `jobs.json`. To regenerate, run `python3 -I tools/kie_generate.py brand/jobs.json brand/kie [ids]` with `KIE_API_KEY` set in the environment, in `KIE_ENV_FILE`, or in `.env.local`.
