import { describe, expect, it } from "vitest";
import { isAiProvider } from "./ai";

describe("isAiProvider 类型 guard", () => {
  it("识别合法 provider", () => {
    expect(isAiProvider("openai")).toBe(true);
    expect(isAiProvider("anthropic")).toBe(true);
    expect(isAiProvider("gemini")).toBe(true);
    expect(isAiProvider("openai-responses")).toBe(true);
  });

  it("非 provider 字符串返回 false", () => {
    expect(isAiProvider("none")).toBe(false);
    expect(isAiProvider("candidate")).toBe(false);
    expect(isAiProvider("gpt")).toBe(false);
    expect(isAiProvider("")).toBe(false);
  });
});
