import { useMemo, useSyncExternalStore } from "react";
import {
  grammarLoadCount,
  type HighlightTheme,
  highlightToHtml,
  subscribeGrammarLoaded,
} from "@/components/markdown/highlight";

/**
 * Highlight `code` with the shared shiki core. Returns HTML, or `null` when the
 * language is unknown or a lazy grammar/theme is still loading (caller shows
 * a plain `<pre>`). Re-renders when a lazy load finishes.
 */
export function useShiki(code: string, lang: string, theme: HighlightTheme): string | null {
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount);
  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded is re-render tick
  return useMemo(() => highlightToHtml(code, lang, theme) ?? null, [code, lang, theme, loaded]);
}
