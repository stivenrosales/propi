import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/content/site";

export const alt = `${site.name}: ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Rendered once at build time from the brand hero.
export default async function OpengraphImage() {
  const [hero, mark] = await Promise.all([
    readFile(join(process.cwd(), "src/app/og-hero.jpg")),
    readFile(join(process.cwd(), "public/brand/propi-mark.svg")),
  ]);
  const heroSrc = `data:image/jpeg;base64,${hero.toString("base64")}`;
  const markSrc = `data:image/svg+xml;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", background: "#FFF6EC" }}>
        <img src={heroSrc} alt="" width={1200} height={630} style={{ position: "absolute", inset: 0 }} />
        <div
          style={{
            position: "absolute",
            left: 64,
            top: 0,
            bottom: 0,
            width: 440,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            color: "#1D1A33",
          }}
        >
          <img src={markSrc} alt="" width={88} height={88} />
          <div style={{ marginTop: 28, fontSize: 76, fontWeight: 800, lineHeight: 0.95, letterSpacing: -2 }}>
            Say thanks. Make it count.
          </div>
          <div style={{ marginTop: 24, fontSize: 26, lineHeight: 1.35, color: "#3b3850" }}>
            Open-source peer recognition for Slack.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
