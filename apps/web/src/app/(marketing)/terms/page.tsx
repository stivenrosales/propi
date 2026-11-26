import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using the hosted Propi: plans and billing, acceptable use, availability, termination and liability.",
  alternates: { canonical: site.terms },
};

const EFFECTIVE = "2026-11-25";

export default function TermsPage() {
  const mail = `mailto:${site.contactEmail}`;
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      effective={EFFECTIVE}
      intro={
        <p>
          These terms apply when your team uses the hosted Propi at propihq.com. By installing Propi in your Slack
          workspace or signing in, you agree to them. They are a plain-language template, not legal advice.
        </p>
      }
    >
      <LegalSection id="service" title="The service">
        <p>
          Propi is peer recognition for Slack: members give props, balances are kept in a ledger, and props can be
          redeemed in your team&apos;s shop. The hosted Propi is operated by Stiven Rosales, an individual based in Peru.
          How we handle data is described in our <a href={site.privacy}>Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection id="plans" title="Plans and billing">
        <ul>
          <li>
            <strong>Free</strong>: up to 10 active members per workspace.
          </li>
          <li>
            <strong>Pro</strong>: $2 per active member per month, billed by Polar, our merchant of record. Seats follow
            your active members, so the number you pay for changes as members join or are deactivated.
          </li>
        </ul>
        <p>Polar handles checkout, invoices, taxes and cancellations under its own terms.</p>
      </LegalSection>

      <LegalSection id="use" title="Acceptable use">
        <p>
          Use Propi for recognition inside your team. Do not use it to harass people, send spam, break the law, or try to
          disrupt, overload or get unauthorized access to the service or other workspaces. Workspace admins are
          responsible for how their workspace uses Propi.
        </p>
      </LegalSection>

      <LegalSection id="open-source" title="Open source">
        <p>
          Propi is open source under the <a href={site.license}>AGPL-3.0</a> license. If you prefer to run it yourself,
          you can self-host it from <a href={site.github}>the GitHub repository</a> instead of using the hosted service.
          These terms cover only the hosted service.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="Availability and no warranty">
        <p>
          We work to keep Propi running and your data safe, but the service is provided &quot;as is&quot; and &quot;as
          available&quot;, without warranties of any kind. It may change, pause for maintenance, or have interruptions.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="Termination">
        <p>
          You can stop using Propi at any time by uninstalling it from Slack and cancelling any paid plan. We may suspend
          or end access for a workspace that breaks these terms. After uninstalling, you can ask us to delete your data
          as described in the <a href={site.privacy}>Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limitation of liability">
        <p>
          To the extent the law allows, we are not liable for indirect or consequential damages, and our total liability
          for any claim is limited to the amount your workspace paid for Propi in the 12 months before the claim.
        </p>
      </LegalSection>

      <LegalSection id="law" title="Governing law">
        <p>These terms are governed by the laws of Peru.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes and contact">
        <p>
          If we change these terms, we will update them on this page and change the effective date above. Questions?
          Write to <a href={mail}>{site.contactEmail}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
