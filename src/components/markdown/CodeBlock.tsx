/**
 * CodeBlock: one code surface for markdown fences with shiki highlighting for
 * the registered grammars and an identical-geometry plain fallback for
 * everything else. Chrome (language banner + copy) matches the markdown code
 * block; token colors stay on `--shiki-*` CSS variables.
 */

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from "./highlight";

export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string;
  /** Grammar hint (markdown fence info string); unknown = plain. */
  lang?: string | undefined;
  /** Extra class merged onto the wrapper. */
  className?: string | undefined;
  /** Copy-button idle label. */
  copyLabel?: string | undefined;
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined;
}

export function CodeBlock({ code, lang, className, copyLabel = "Copy", copiedLabel = "Copied" }: CodeBlockProps) {
  const trimmed = code.endsWith("\n") ? code.slice(0, -1) : code;
  // Re-render when a lazy grammar finishes loading, so a fence that showed
  // plain text while its language's grammar imported picks up highlighting.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount);
  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded is re-render tick
  const html = useMemo(() => highlightToHtml(trimmed, lang), [trimmed, lang, loaded]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    if (copied) return;
    const text = rootRef.current?.querySelector("pre")?.textContent ?? trimmed;
    void copyToClipboard(text).then(() => {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1000);
    });
  }, [copied, trimmed]);

  const body =
    html === undefined ? (
      <pre className="md-code-block-plain">
        <code>{trimmed}</code>
      </pre>
    ) : (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki codeToHtml output is an escaped static span tree; no user HTML passes through.
      <div dangerouslySetInnerHTML={{ __html: html }} />
    );

  return (
    <div ref={rootRef} className={cn("md-code-block", className)}>
      <div className="md-code-block-banner-wrap">
        <div className="md-code-block-banner">
          <div className="md-code-block-infostring">{lang ?? ""}</div>
          <button type="button" className="md-code-block-copy" onClick={onCopy}>
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
      </div>
      {body}
    </div>
  );
}
