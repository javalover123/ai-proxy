import { describe, expect, it } from "vitest";
import { detectLanguage, resolveEffectiveLang } from "./language";

describe("detectLanguage", () => {
  it("treats object/array-looking content as json", () => {
    expect(detectLanguage('{"a":1}')).toBe("json");
    expect(detectLanguage("  [1, 2]")).toBe("json");
  });

  it("treats tag-looking content as xml", () => {
    expect(detectLanguage("<root></root>")).toBe("xml");
    expect(detectLanguage('  <?xml version="1.0"?>')).toBe("xml");
  });

  it("returns null for plain text", () => {
    expect(detectLanguage("hello")).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });
});

describe("resolveEffectiveLang", () => {
  it("lets an explicit language win over content", () => {
    expect(resolveEffectiveLang("json", "<xml/>")).toBe("json");
    expect(resolveEffectiveLang("javascript", '{"a":1}')).toBe("javascript");
  });

  it("auto-detects from content and falls back to text", () => {
    expect(resolveEffectiveLang("auto", '{"a":1}')).toBe("json");
    expect(resolveEffectiveLang("auto", "<x/>")).toBe("xml");
    expect(resolveEffectiveLang("auto", "plain")).toBe("text");
  });
});
