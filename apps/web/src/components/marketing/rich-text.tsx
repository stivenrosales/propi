import { Fragment, type ReactNode } from "react";

/**
 * Renders a translated message whose `{name}` placeholders stand for elements (a link, a bold word,
 * an icon). Translate with each element's placeholder passed through as itself, e.g.
 * `rich(t("who.body", { mail: "{mail}" }), { mail: <a href={…}>…</a> })`, so word order stays in the
 * catalog and the elements stay in the component.
 */
export function rich(text: string, nodes: Readonly<Record<string, ReactNode>>): ReactNode {
  return text.split(/(\{\w+\})/g).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>;
  });
}
