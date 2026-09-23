import { useCallback, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * 通用的复制到剪贴板 hook，支持自动重置 copied 状态。
 * 优先 Clipboard API，失败时 fallback 到 execCommand('copy')。
 */
export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string) => {
      await copyToClipboard(text);
      setCopied(true);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );

  return { copied, copy };
}
