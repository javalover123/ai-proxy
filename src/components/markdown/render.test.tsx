import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseGfm, parseGfmWithMath } from "./parse";
import {
  collectReferenceTargets,
  createReferenceTargets,
  type MarkdownRenderContext,
  renderBlocks,
  renderFootnoteSection,
} from "./render";

function settledContext(streaming = false): MarkdownRenderContext {
  return {
    streaming,
    codeLabels: undefined,
    fileMentions: undefined,
    targets: createReferenceTargets(),
    footnoteOrder: [],
    footnoteCounts: new Map(),
  };
}

function render(text: string, streaming = false): string {
  const root = streaming ? parseGfm(text) : parseGfmWithMath(text);
  const context = settledContext(streaming);
  collectReferenceTargets(root.children, context.targets);
  const blocks = renderBlocks(
    root.children.map((node, index) => ({ node, key: index })),
    context,
  );
  const section = renderFootnoteSection(context);
  const all = section === null ? blocks : [...blocks, section];
  return renderToStaticMarkup(all);
}

describe("mdast→React 直渲染", () => {
  it("渲染 GFM 标题、强调、行内代码与链接", () => {
    const html = render("# 标题\n\n**粗体** 与 `code` 以及 [链接](https://example.com)");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('target="_blank"');
  });

  it("列表、引用与分隔线", () => {
    const html = render("> 引用\n\n- a\n- b\n\n---");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<li>b</li>");
    expect(html).toContain("<hr/>");
  });

  it("原始 HTML 按文本展示，不进入 DOM", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("危险协议链接降级为普通文字", () => {
    const html = render("[x](javascript:alert(1))");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain(">x</");
  });

  it("危险图片不生成 <img>，回退为 alt 文本", () => {
    const html = render("![alt](file:///etc/passwd)");
    expect(html).not.toContain("<img");
    expect(html).toContain("alt");
  });

  it("绝对 http 图片正常渲染", () => {
    const html = render("![a](https://example.com/a.png)");
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("流式阶段代码块为 plain（无 shiki 高亮）", () => {
    const html = render("```ts\nconst x = 1\n```", true);
    expect(html).toContain("md-code-block-plain");
    expect(html).not.toContain("shiki");
  });

  it("定稿阶段代码块保留语言标签并启用高亮", () => {
    const html = render("```ts\nconst x = 1\n```");
    expect(html).toContain("md-code-block-infostring");
    expect(html).toContain(">ts</div>");
  });

  it("脚注在定稿时渲染编号与脚注区", () => {
    const html = render("正文[^1]\n\n[^1]: 脚注内容");
    expect(html).toContain("<sup>1</sup>");
    expect(html).toContain("footnotes");
  });
});
