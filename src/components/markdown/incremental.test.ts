import { describe, expect, it } from "vitest";
import { IncrementalMarkdownParser } from "./incremental";
import { parseGfm } from "./parse";

/** 逐前缀喂入，校验冻结块 + 尾部块总是等价于一次性全量解析的顶层块。 */
function checkPrefixConsistency(text: string, chunk: number) {
  const parser = new IncrementalMarkdownParser(parseGfm);
  let prefix = "";
  let i = 0;
  while (i < text.length) {
    prefix = text.slice(0, i + chunk);
    const { frozen, tail } = parser.update(prefix);
    const incremental = [...frozen, ...tail].map((b) => b.node.type);
    const fresh = parseGfm(prefix).children.map((n) => n.type);
    expect(incremental).toEqual(fresh);
    i += chunk;
  }
}

describe("IncrementalMarkdownParser", () => {
  const sample = "# 标题\n\n第一段文本。\n\n- 列表项 A\n- 列表项 B\n\n```ts\nconst x = 1\n```\n\n结尾段落";

  it("任意 chunk 大小的每个前缀都与全量解析一致", () => {
    for (const chunk of [1, 3, 7, 16]) {
      checkPrefixConsistency(sample, chunk);
    }
  });

  it("相同输入幂等返回同一结果", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const a = parser.update(sample);
    const b = parser.update(sample);
    expect(a).toBe(b);
  });

  it("非 append 输入重置并递增 generation", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const first = parser.update("第一段");
    expect(first.generation).toBe(0);
    const second = parser.update("完全不同的内容");
    expect(second.generation).toBe(1);
    expect(second.frozen).toEqual([]);
  });

  it("稳定块的 key 使用绝对源码偏移", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const { frozen, tail } = parser.update("# 一\n\n# 二\n\n# 三\n\n# 四");
    // 至少有尾部两个块不稳定，更早的块被冻结
    expect(frozen.length).toBeGreaterThan(0);
    const keys = [...frozen, ...tail].map((b) => b.key);
    // 绝对偏移随源文本单调递增（无 position 的兜底负值除外）
    const positive = keys.filter((k) => k >= 0);
    expect(positive).toEqual([...positive].sort((a, b) => a - b));
  });

  it("未闭合围栏使整个尾部保持不稳定", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const { frozen, tail } = parser.update("```ts\n未闭合");
    // 未闭合围栏只有一个块，无法冻结
    expect(frozen.length).toBe(0);
    expect(tail.length).toBe(1);
  });
});
