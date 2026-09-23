import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export type ProseFontSize = "small" | "normal" | "large";

/** 档位 → --prose-scale 系数（以 prose-md 13px 为锚：小 11px / 标准 13px / 大 15px） */
const SCALE: Record<ProseFontSize, string> = {
  small: "0.8462",
  normal: "1",
  large: "1.1538",
};

function apply(size: ProseFontSize) {
  document.documentElement.style.setProperty("--prose-scale", SCALE[size]);
}

/** 内容字号档位：仅缩放数据内容区（--text-prose-*），UI 骨架不受影响 */
export function useProseFontSize() {
  const [proseFontSize, setState] = useState<ProseFontSize>("normal");

  useEffect(() => {
    invoke<ProseFontSize>("get_prose_font_size")
      .then((size) => {
        setState(size);
        apply(size);
      })
      .catch(() => apply("normal"));
  }, []);

  const setProseFontSize = useCallback((size: ProseFontSize) => {
    invoke<string>("set_prose_font_size", { size })
      .then(() => {
        setState(size);
        apply(size);
      })
      .catch((err) => console.error("Failed to save prose font size:", err));
  }, []);

  return { proseFontSize, setProseFontSize };
}
