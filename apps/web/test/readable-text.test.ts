import { describe, expect, it } from "vitest";
import { readableText } from "../src/lib/format";

describe("readableText", () => {
  it("drops Slack emoji codes and tidies the spacing", () => {
    expect(readableText(":propi: :propi: thanks for the help :tada:")).toBe("thanks for the help");
  });

  it("keeps mentions readable", () => {
    expect(readableText("<@ana-torres> :taco: great demo", (id) => (id === "ana-torres" ? "Ana Torres" : id))).toBe("@Ana Torres great demo");
  });

  it("leaves times and ratios alone", () => {
    expect(readableText("standup at 10:30 went 2:1")).toBe("standup at 10:30 went 2:1");
  });
});
