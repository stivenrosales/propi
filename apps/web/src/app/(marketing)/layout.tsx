import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

// Public marketing pages. Admin and shop live in their own route groups.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="overflow-x-clip outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
