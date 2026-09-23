import { type RefObject, useEffect } from "react";

/**
 * 监听元素外部的点击事件，触发回调。
 * 使用 document 捕获阶段监听，确保比冒泡更早响应。
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, callback: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        callback();
      }
    };

    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [enabled, callback, ref]);
}
