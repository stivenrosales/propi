// S91: the Summarizer port over the Vercel AI SDK + OpenRouter. Core selected the input (stored gift
// text grouped by value) and validates the links afterwards (linkDigest drops any quote that is not
// in the input), so a model that invents gift ids cannot put words in anyone's mouth.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import type { DigestSummary, DigestTheme, EnabledDigestInput, Summarizer } from "@propi/core/insights";
import type { GiftId, MemberId, ValueId } from "@propi/app";

const SYSTEM = `You summarize a month of peer recognition messages for a team.
Reply with JSON only, no prose, in this exact shape:
{"team":[{"title":string,"summary":string,"valueId":string|null,"giftIds":string[]}],
 "members":[{"memberId":string,"themes":[{"title":string,"summary":string,"valueId":string|null,"giftIds":string[]}]}]}
Rules: at most 4 team themes and 3 themes per member; each theme cites the giftIds it is based on,
copied exactly from the input; titles under 8 words; summaries under 40 words; use the language of
the quotes; never invent people, numbers or gift ids.`;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function theme(v: unknown): DigestTheme | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const title = str(o["title"]);
  const summary = str(o["summary"]);
  if (title === null || summary === null) return null;
  const giftIds = Array.isArray(o["giftIds"]) ? o["giftIds"].filter((x): x is string => typeof x === "string") : [];
  return { title, summary, valueId: (str(o["valueId"]) as ValueId | null) ?? null, giftIds: giftIds as GiftId[] };
}

/** Parses the model's reply leniently: anything malformed is dropped, never thrown into a job. */
export function parseDigestReply(text: string): DigestSummary {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let raw: unknown = null;
  try {
    raw = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    raw = null;
  }
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const team = (Array.isArray(o["team"]) ? o["team"] : []).map(theme).filter((t): t is DigestTheme => t !== null);
  const members = (Array.isArray(o["members"]) ? o["members"] : []).flatMap((m) => {
    if (typeof m !== "object" || m === null) return [];
    const r = m as Record<string, unknown>;
    const memberId = str(r["memberId"]);
    if (memberId === null) return [];
    const themes = (Array.isArray(r["themes"]) ? r["themes"] : []).map(theme).filter((t): t is DigestTheme => t !== null);
    return [{ memberId: memberId as MemberId, themes }];
  });
  return { team, members };
}

export function openRouterSummarizer(opts: { readonly apiKey: string; readonly model: string; readonly timeoutMs?: number }): Summarizer {
  const openrouter = createOpenRouter({ apiKey: opts.apiKey });
  return {
    async summarize(input: EnabledDigestInput): Promise<DigestSummary> {
      const { text } = await generateText({
        model: openrouter(opts.model),
        system: SYSTEM,
        prompt: JSON.stringify(input),
        timeout: opts.timeoutMs ?? 120_000,
      });
      return parseDigestReply(text);
    },
  };
}
