import Image from "next/image";
import { site } from "@/content/site";
import { ButtonLink, GitHubIcon } from "@/components/ui/primitives";
import { CopyButton } from "./copy-button";
import thumbs from "../../../public/brand/mascot-thumbs-up.webp";

const commands = [`git clone ${site.github}.git`, "cd propi", "docker compose up -d"];

export function SelfHost() {
  return (
    <section id="self-host" aria-labelledby="self-host-title" className="relative overflow-hidden bg-ink py-24 text-cream sm:py-32">
      <span id="install" className="absolute top-0" aria-hidden="true" />
      <div className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-14 px-4 sm:px-6 lg:grid-cols-12 lg:items-center lg:px-10">
        <div className="lg:col-span-5">
          <h2
            id="self-host-title"
            className="font-display text-[clamp(2.25rem,1.5rem+3vw,3.75rem)] leading-[1.02] font-black tracking-[-0.03em] text-balance"
          >
            Open source. <span className="text-sunflower">Yours</span> to run.
          </h2>
          <p className="mt-6 max-w-[44ch] text-lg leading-[1.7] text-cream/80">
            Clone the repo, start the stack, connect your Slack workspace. Every balance lives in your own Postgres
            database.
          </p>
          <p className="mt-4 max-w-[44ch] leading-[1.7] text-cream/70">
            Propi is in active development. Star the repo to follow along, open an issue, or send a pull request.
          </p>
          <div className="mt-9">
            <ButtonLink href={site.github} tone="coral">
              <GitHubIcon className="size-5" />
              Star on GitHub
            </ButtonLink>
          </div>
        </div>

        <div className="relative mt-16 lg:col-span-7 lg:mt-0">
          <Image
            src={thumbs}
            alt=""
            sizes="140px"
            className="bob pointer-events-none absolute -top-[5.25rem] right-4 z-10 h-auto w-24 sm:-top-[7rem] sm:right-8 sm:w-32"
          />
          <figure className="reveal overflow-hidden rounded-[1.75rem] border-2 border-cream/20 bg-ink-raised">
            <div className="flex items-center justify-between gap-4 border-b-2 border-cream/10 px-5 py-3">
              <div className="flex items-center gap-2" aria-hidden="true">
                <span className="size-3 rounded-full bg-coral" />
                <span className="size-3 rounded-full bg-sunflower" />
                <span className="size-3 rounded-full bg-mint" />
              </div>
              <figcaption className="text-xs font-medium text-cream/60">Terminal</figcaption>
              <CopyButton text={commands.join("\n")} />
            </div>
            <pre className="overflow-x-auto px-5 py-6 text-[0.9rem] leading-[1.9] sm:px-7 sm:text-base">
              <code>
                {commands.map((cmd) => (
                  <span key={cmd} className="block whitespace-pre">
                    <span className="text-mint select-none" aria-hidden="true">
                      ${" "}
                    </span>
                    <span className={cmd.startsWith("docker") ? "font-semibold text-sunflower" : "text-cream"}>{cmd}</span>
                  </span>
                ))}
              </code>
            </pre>
          </figure>
        </div>
      </div>
    </section>
  );
}
