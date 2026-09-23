import { describe, expect, it, vi } from "vitest";
import { createImeDocChangeGate } from "./ime";

describe("createImeDocChangeGate", () => {
  it("emits immediately when not composing", () => {
    const emit = vi.fn();
    const gate = createImeDocChangeGate(emit);
    gate.onDocChanged("a");
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("a");
  });

  it("holds document changes during IME composition", () => {
    const emit = vi.fn();
    const gate = createImeDocChangeGate(emit);
    gate.compositionStart();
    gate.onDocChanged("你");
    gate.onDocChanged("你好");
    expect(emit).not.toHaveBeenCalled();
  });

  it("flushes the latest document on composition end", () => {
    const emit = vi.fn();
    const gate = createImeDocChangeGate(emit);
    gate.compositionStart();
    gate.onDocChanged("你");
    gate.onDocChanged("你好");
    gate.compositionEnd("你好");
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("你好");
  });

  it("does not emit on composition end when nothing changed", () => {
    const emit = vi.fn();
    const gate = createImeDocChangeGate(emit);
    gate.compositionStart();
    gate.compositionEnd("unchanged");
    expect(emit).not.toHaveBeenCalled();
  });
});
