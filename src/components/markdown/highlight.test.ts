import { describe, expect, it } from "vitest";
import { highlightToHtml, subscribeGrammarLoaded } from "./highlight";

type NamedTheme = "github-light" | "github-dark";

async function highlightWhenReady(code: string, lang: string, theme: NamedTheme): Promise<string | undefined> {
  const first = highlightToHtml(code, lang, theme);
  if (first !== undefined) return first;
  await new Promise<void>((resolve) => {
    const unsub = subscribeGrammarLoaded(() => {
      unsub();
      resolve();
    });
  });
  return highlightToHtml(code, lang, theme);
}

describe("highlightToHtml themes", () => {
  it("defaults to css-variables for boot grammars", () => {
    const html = highlightToHtml("const answer: number = 42", "ts");
    expect(html).toBeDefined();
    expect(html).toContain("css-variables");
    expect(html).toContain("--shiki-");
  });

  it("github-light emits the github-light theme class, not css-variables", async () => {
    const html = await highlightWhenReady("const answer: number = 42", "ts", "github-light");
    expect(html).toContain("github-light");
    expect(html).not.toContain("css-variables");
  });

  it("github-dark emits the github-dark theme class", async () => {
    const html = await highlightWhenReady("const answer: number = 42", "ts", "github-dark");
    expect(html).toContain("github-dark");
    expect(html).not.toContain("css-variables");
  });

  it("unknown language stays undefined even when a named theme is requested", () => {
    expect(highlightToHtml("hello", "not-a-lang", "github-light")).toBeUndefined();
  });
});
