import { describe, expect, it } from "vitest";
import { cx } from "../src/lib/cx";

describe("cx", () => {
  it("joins truthy classes", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
  });

  it("lets a later background win over an earlier one", () => {
    expect(cx("rounded bg-white p-5", "bg-ink text-cream")).toBe("rounded p-5 bg-ink text-cream");
  });

  it("resolves padding per breakpoint", () => {
    expect(cx("p-5 md:p-6", "p-4 md:p-5")).toBe("p-4 md:p-5");
  });

  it("treats border color and border width as separate groups", () => {
    expect(cx("border border-line", "border-coral")).toBe("border border-coral");
    expect(cx("border-2 border-ink", "border")).toBe("border-ink border");
  });

  it("treats text color and text size as separate groups", () => {
    expect(cx("text-sm text-ink", "text-cream")).toBe("text-sm text-cream");
    expect(cx("text-sm text-ink", "text-base")).toBe("text-ink text-base");
  });

  it("keeps unrelated utilities untouched", () => {
    expect(cx("flex gap-2", "items-center gap-4")).toBe("flex items-center gap-4");
  });
});
