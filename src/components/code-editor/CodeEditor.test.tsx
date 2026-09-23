import { undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CodeEditor from "./CodeEditor";

function injectedCss(): string {
  return [...document.querySelectorAll("style")].map((el) => el.textContent ?? "").join("\n");
}

function getView(container: HTMLElement): EditorView {
  const el = container.querySelector(".cm-editor");
  if (!el) throw new Error("CodeMirror editor not mounted");
  const view = EditorView.findFromDOM(el as HTMLElement);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("CodeEditor", () => {
  it("keeps undo history when the language changes", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<CodeEditor value="" language="text" onChange={onChange} />);
    const view = getView(container);
    view.dispatch({ changes: { from: 0, insert: "{" } });

    rerender(<CodeEditor value="{" language="json" onChange={onChange} />);
    const viewAfter = getView(container);
    expect(viewAfter).toBe(view);

    undo(viewAfter);
    expect(viewAfter.state.doc.toString()).toBe("");
  });

  it("does not emit onChange while composing, then flushes on compositionend", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor value="" language="text" onChange={onChange} />);
    const view = getView(container);
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dispatch({ changes: { from: 0, insert: "你" } });
    expect(onChange).not.toHaveBeenCalled();

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("你");
  });

  it("rejects edits when readOnly", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor value="abc" language="text" onChange={onChange} readOnly />);
    const view = getView(container);
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
  });

  it("enables line wrapping when wordWrap is set", () => {
    const { container } = render(<CodeEditor value="hello" language="text" onChange={() => {}} wordWrap />);
    const view = getView(container);
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
  });

  it("themes the built-in search panel with semantic color tokens", () => {
    const { container } = render(<CodeEditor value="hello name" language="text" onChange={() => {}} />);
    const view = getView(container);
    openSearchPanel(view);

    expect(container.querySelector(".cm-panel.cm-search")).toBeTruthy();

    const css = injectedCss();
    expect(css).toMatch(/\.cm-panels[^}]*var\(--surface-elevated\)/);
    expect(css).toMatch(/\.cm-textfield[^}]*var\(--background\)/);
    expect(css).toMatch(/\.cm-button[^}]*var\(--secondary\)/);
    expect(css).toMatch(/\.cm-searchMatch[^}]*var\(--foreground\)/);
  });
});
