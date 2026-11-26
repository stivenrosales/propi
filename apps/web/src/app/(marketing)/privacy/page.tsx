import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";
import { rich } from "@/components/marketing/rich-text";
import { site } from "@/content/site";
import { getLocale } from "@/i18n/locale";
import { privacy } from "@/i18n/legal.messages";

// i18n S5: same URL in both languages; the title and description follow the request's language.
export async function generateMetadata(): Promise<Metadata> {
  const t = privacy.t(await getLocale());
  return { title: t("meta.title"), description: t("meta.description"), alternates: { canonical: site.privacy } };
}

const EFFECTIVE = "2026-11-25";

// Subprocessors named in the policy: Slack, Polar, Stripe, Resend, PostHog, OVH, Cloudflare.
export default async function PrivacyPage() {
  const t = privacy.t(await getLocale());
  const mail = <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>;
  return (
    <LegalPage title={t("title")} effective={EFFECTIVE} intro={<p>{t("intro")}</p>}>
      <LegalSection id="who" title={t("who.title")}>
        <p>{rich(t("who.body", { mail: "{mail}" }), { mail })}</p>
      </LegalSection>

      <LegalSection id="collect" title={t("collect.title")}>
        <p>{rich(t("collect.slack", { from: "{from}" }), { from: <strong>{t("collect.slack.from")}</strong> })}</p>
        <ul>
          <li>{t("collect.field.id")}</li>
          <li>{t("collect.field.name")}</li>
          <li>{t("collect.field.email")}</li>
          <li>{t("collect.field.avatar")}</li>
          <li>{t("collect.field.timezone")}</li>
        </ul>
        <p>{rich(t("collect.use", { from: "{from}" }), { from: <strong>{t("collect.use.from")}</strong> })}</p>
      </LegalSection>

      <LegalSection id="why" title={t("why.title")}>
        <p>{t("why.body")}</p>
      </LegalSection>

      <LegalSection id="payments" title={t("payments.title")}>
        <p>{t("payments.body")}</p>
      </LegalSection>

      <LegalSection id="subprocessors" title={t("sub.title")}>
        <p>{t("sub.intro")}</p>
        <ul>
          <li>
            <strong>Slack</strong>: {t("sub.slack")}
          </li>
          <li>{rich(t("sub.polar", { polar: "{polar}", stripe: "{stripe}" }), { polar: <strong>Polar</strong>, stripe: <strong>Stripe</strong> })}</li>
          <li>
            <strong>Resend</strong>: {t("sub.resend")}
          </li>
          <li>
            <strong>PostHog</strong>: {t("sub.posthog")}
          </li>
          <li>{rich(t("sub.ovh", { ovh: "{ovh}" }), { ovh: <strong>OVH</strong> })}</li>
          <li>
            <strong>Cloudflare</strong>: {t("sub.cloudflare")}
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="retention" title={t("retention.title")}>
        <p>{rich(t("retention.body", { mail: "{mail}" }), { mail })}</p>
      </LegalSection>

      <LegalSection id="rights" title={t("rights.title")}>
        <p>{rich(t("rights.body", { mail: "{mail}" }), { mail })}</p>
      </LegalSection>

      <LegalSection id="changes" title={t("changes.title")}>
        <p>{t("changes.body")}</p>
      </LegalSection>
    </LegalPage>
  );
}
