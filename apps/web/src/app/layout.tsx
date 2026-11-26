import type { Metadata, Viewport } from "next";
import { Inter, Nunito } from "next/font/google";
import { site } from "@/content/site";
import { Analytics } from "@/components/analytics";
import { getLocale } from "@/i18n/locale";
import { meta } from "@/i18n/meta.messages";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// i18n S4: metadata and <html lang> follow the request's language (getLocale).
export async function generateMetadata(): Promise<Metadata> {
  const t = meta.t(await getLocale());
  const title = t("title.default");
  const description = t("description");
  return {
    metadataBase: new URL(site.url),
    title: { default: title, template: `%s · ${site.name}` },
    description,
    applicationName: site.name,
    icons: { icon: { url: "/brand/propi-mascot-icon.png", type: "image/png" } },
    openGraph: { type: "website", siteName: site.name, title, description, url: "/" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export const viewport: Viewport = {
  themeColor: "#fff6ec",
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${nunito.variable} ${inter.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
