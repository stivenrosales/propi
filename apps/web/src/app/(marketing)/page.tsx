import { Faq } from "@/components/marketing/faq";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SelfHost } from "@/components/marketing/self-host";
import { WhyPropi } from "@/components/marketing/why-propi";
import { ButtonLink, SlackIcon } from "@/components/ui/primitives";

/** S2: the hosted Propi. "Add to Slack" starts the OAuth v2 install (/slack/install). */
function AddToSlack() {
  return (
    <section id="cloud" aria-labelledby="cloud-title" className="py-20 sm:py-24">
      <div className="mx-auto flex max-w-[1240px] flex-col items-start gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-10">
        <div>
          <h2 id="cloud-title" className="font-display text-[clamp(1.75rem,1.25rem+2vw,2.75rem)] leading-[1.05] font-black tracking-[-0.03em] text-balance">
            Rather not run a server?
          </h2>
          <p className="mt-3 max-w-[52ch] text-lg leading-[1.6] text-ink-soft">
            Add the hosted Propi to your Slack workspace. Whoever installs it becomes the first admin.
          </p>
        </div>
        <ButtonLink href="/slack/install" tone="coral">
          <SlackIcon className="size-5" />
          Add to Slack
        </ButtonLink>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <WhyPropi />
      <AddToSlack />
      <SelfHost />
      <Faq />
    </>
  );
}
