import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useShiki } from "./useShiki";

describe("useShiki", () => {
  it("returns css-variables HTML for a boot grammar", () => {
    const { result } = renderHook(() => useShiki("const x = 1", "ts", "css-variables"));
    expect(result.current).toContain("css-variables");
  });

  it("returns github-light HTML after the theme loads", async () => {
    const { result } = renderHook(() => useShiki("const x = 1", "ts", "github-light"));
    await waitFor(() => {
      expect(result.current).toContain("github-light");
    });
  });

  it("returns null for an unknown language", () => {
    const { result } = renderHook(() => useShiki("hello", "not-a-lang", "github-light"));
    expect(result.current).toBeNull();
  });
});
