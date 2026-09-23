import { describe, expect, it } from "vitest";
import { formatSettledJson } from "./formatSettledJson";

describe("formatSettledJson", () => {
  it("流式阶段即使是完整 JSON 也不切到 pretty-print", () => {
    expect(formatSettledJson('{"ok":true}', true)).toBeNull();
  });

  it("定稿后对象/数组美化输出", () => {
    expect(formatSettledJson('{"ok":true}', false)).toBe('{\n  "ok": true\n}');
  });

  it("半截 JSON 返回 null，留给 Markdown 渲染", () => {
    expect(formatSettledJson('{"ok":', false)).toBeNull();
  });
});
