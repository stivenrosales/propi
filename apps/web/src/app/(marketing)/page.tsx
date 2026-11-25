import { Faq } from "@/components/marketing/faq";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SelfHost } from "@/components/marketing/self-host";
import { WhyPropi } from "@/components/marketing/why-propi";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <WhyPropi />
      <SelfHost />
      <Faq />
    </>
  );
}
