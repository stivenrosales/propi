import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What the hosted Propi collects from Slack and from your team's use, why, who processes it, and how to export or delete it.",
  alternates: { canonical: site.privacy },
};

const EFFECTIVE = "2026-11-25";

export default function PrivacyPage() {
  const mail = `mailto:${site.contactEmail}`;
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      effective={EFFECTIVE}
      intro={
        <p>
          This policy explains what the hosted Propi at propihq.com collects, why, and what you can do about it. We keep
          it short and in plain language. It is a plain-language template, not legal advice. If you self-host Propi,
          your data never reaches us and this policy does not apply to your installation.
        </p>
      }
    >
      <LegalSection id="who" title="Who we are">
        <p>
          The hosted Propi is operated by Stiven Rosales, an individual based in Peru. You can reach us at{" "}
          <a href={mail}>{site.contactEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <p>
          <strong>From Slack</strong>, when your workspace installs Propi or a member signs in, we store each member&apos;s:
        </p>
        <ul>
          <li>Slack user id</li>
          <li>name</li>
          <li>email</li>
          <li>avatar</li>
          <li>timezone</li>
        </ul>
        <p>
          <strong>From using Propi</strong>, we store the recognition data your team creates: gifts, the ledger of
          balances, and redemptions, plus your workspace settings.
        </p>
      </LegalSection>

      <LegalSection id="why" title="Why we use it">
        <p>
          We use this data only to run Propi for your workspace: to show who gave props to whom, keep balances correct,
          process redemptions in your shop, apply your settings, send the emails the service needs, and understand how
          the product is used so we can improve it. We do not sell your data.
        </p>
      </LegalSection>

      <LegalSection id="payments" title="Payments">
        <p>
          Paid plans are sold through Polar, which acts as the merchant of record and handles checkout, invoices and
          taxes. Card payments are processed by Stripe on Polar&apos;s behalf. We never see or store your card number.
        </p>
      </LegalSection>

      <LegalSection id="subprocessors" title="Subprocessors">
        <p>These services process data for us so Propi can run:</p>
        <ul>
          <li>
            <strong>Slack</strong>: sign-in, member profiles and messages inside your workspace
          </li>
          <li>
            <strong>Polar</strong> (with <strong>Stripe</strong>): payments and billing
          </li>
          <li>
            <strong>Resend</strong>: email delivery
          </li>
          <li>
            <strong>PostHog</strong>: product analytics
          </li>
          <li>
            <strong>OVH</strong> (VPS): hosting of the app and its database
          </li>
          <li>
            <strong>Cloudflare</strong>: DNS
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep it">
        <p>
          Your data stays in Propi while your workspace uses it. Uninstalling Propi from Slack does not delete it: we
          keep it until a workspace admin asks us to delete it at <a href={mail}>{site.contactEmail}</a>. You can export
          your data as CSV at any time from the admin dashboard.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="Your rights">
        <p>
          You can ask us to access, correct, export or delete the data we hold about you or your workspace. Write to{" "}
          <a href={mail}>{site.contactEmail}</a> and we will answer.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>
          If we change this policy, we will update it on this page and change the effective date above.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
