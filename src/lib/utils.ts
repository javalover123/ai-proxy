import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// 注册自定义字号阶梯（--text-ui-* / --text-prose-*，见 index.css @theme），
// 否则 tailwind-merge 不认识它们，会与 text-<颜色> 类误判为同组冲突而将字号类丢弃
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "ui-2xs",
            "ui-xs",
            "ui-sm",
            "ui-md",
            "ui-lg",
            "prose-xs",
            "prose-sm",
            "prose-md",
            "prose-lg",
            "prose-xl",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
