import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";
import { rich } from "@/components/marketing/rich-text";
import { site } from "@/content/site";
import { getLocale } from "@/i18n/locale";
import { terms } from "@/i18n/legal.messages";

// i18n S5: same URL in both languages; the title and description follow the request's language.
export async function generateMetadata(): Promise<Metadata> {
  const t = terms.t(await getLocale());
  return { title: t("meta.title"), description: t("meta.description"), alternates: { canonical: site.terms } };
}

const EFFECTIVE = "2026-11-25";

export default async function TermsPage() {
  const t = terms.t(await getLocale());
  const mail = <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>;
  const privacyLink = <a href={site.privacy}>{t("privacyLink")}</a>;
  return (
    <LegalPage title={t("title")} effective={EFFECTIVE} intro={<p>{t("intro")}</p>}>
      <LegalSection id="service" title={t("service.title")}>
        <p>{rich(t("service.body", { privacy: "{privacy}" }), { privacy: privacyLink })}</p>
      </LegalSection>

      <LegalSection id="plans" title={t("plans.title")}>
        <ul>
          <li>
            {rich(t("plans.free", { name: "{name}", free: site.pricing.freeActiveMembers }), {
              name: <strong>{t("plans.free.name")}</strong>,
            })}
          </li>
          <li>
            {rich(t("plans.pro", { name: "{name}", price: site.pricing.proPerActiveMemberUsd }), {
              name: <strong>{t("plans.pro.name")}</strong>,
            })}
          </li>
        </ul>
        <p>{t("plans.polar")}</p>
      </LegalSection>

      <LegalSection id="use" title={t("use.title")}>
        <p>{t("use.body")}</p>
      </LegalSection>

      <LegalSection id="open-source" title={t("open.title")}>
        <p>
          {rich(t("open.body", { license: "{license}", github: "{github}" }), {
            license: <a href={site.license}>AGPL-3.0</a>,
            github: <a href={site.github}>{t("open.github")}</a>,
          })}
        </p>
      </LegalSection>

      <LegalSection id="availability" title={t("availability.title")}>
        <p>{t("availability.body")}</p>
      </LegalSection>

      <LegalSection id="termination" title={t("termination.title")}>
        <p>{rich(t("termination.body", { privacy: "{privacy}" }), { privacy: privacyLink })}</p>
      </LegalSection>

      <LegalSection id="liability" title={t("liability.title")}>
        <p>{t("liability.body")}</p>
      </LegalSection>

      <LegalSection id="law" title={t("law.title")}>
        <p>{t("law.body")}</p>
      </LegalSection>

      <LegalSection id="changes" title={t("changes.title")}>
        <p>{rich(t("changes.body", { mail: "{mail}" }), { mail })}</p>
      </LegalSection>
    </LegalPage>
  );
}
