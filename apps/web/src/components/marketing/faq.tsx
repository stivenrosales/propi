import { site } from "@/content/site";
const faqs = [
  {
    q: "How much does Propi cost?",
    a: `The hosted Propi is free for teams up to ${site.pricing.freeActiveMembers} active members. Bigger teams pay $2 per active member per month for Pro. Propi is also open source under the AGPL-3.0 license, so you can host it yourself for free.`,
  },
  {
    q: "Do we have to use tacos?",
    a: "No. Each workspace picks its own currency: one main emoji with a singular and plural name, plus extra emoji worth more, like a fire emoji worth 3. Changing it later never rewrites past gifts.",
  },
  {
    q: "What happens when someone gives more than their allowance?",
    a: "Nothing moves, so balances stay correct. The giver gets a private message with the cost, what they have left today and how to fix it.",
  },
  {
    q: "Can we bring our history from HeyTaco?",
    a: "Yes. The importer reads HeyTaco's activity exports, users file and redemption files. Members are matched by Slack id or email, and running the import twice changes nothing.",
  },
  {
    q: "Who delivers the rewards?",
    a: "Approvers handle requests inside Propi, and they or an external system can mark them fulfilled. Every state change fires a signed webhook, so your finance or HR tools can do the paying.",
  },
  {
    q: "Does it work with Microsoft Teams?",
    a: "Slack comes first. Teams is planned next with the same rules, and one person's balance will be shared across both.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-10">
        <h2
          id="faq-title"
          className="font-display text-[clamp(2.25rem,1.5rem+3vw,3.75rem)] leading-[0.98] font-black tracking-[-0.03em] text-balance lg:col-span-4"
        >
          Questions, answered.
        </h2>
        <div className="divide-y-2 divide-ink border-y-2 border-ink lg:col-span-8">
          {faqs.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer items-center justify-between gap-6 py-6 font-display text-xl font-extrabold tracking-tight sm:text-[1.4rem]">
                {item.q}
                <span
                  aria-hidden="true"
                  className="faq-plus grid size-9 shrink-0 place-items-center rounded-full border-2 border-ink bg-sunflower text-xl leading-none font-black group-open:bg-coral"
                >
                  +
                </span>
              </summary>
              <p className="max-w-[62ch] pb-7 text-[1.05rem] leading-relaxed text-ink-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
