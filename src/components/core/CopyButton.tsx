import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export interface CopyButtonProps {
  /** 要复制的文本内容 */
  text: string;
  /** 图标尺寸，对应 lucide size-*：xs=2.5, sm=3, md=3.5。默认 sm */
  size?: "xs" | "sm" | "md";
  /** 文本标签（右键菜单 / 有字按钮场景），无 label 时仅显示图标 */
  label?: string;
  /** 对勾持续时间 ms，默认 1500 */
  resetMs?: number;
  /** 外层 className（定位、颜色、hover 等） */
  className?: string;
  /** 按钮 type，默认 "button" */
  type?: "button" | "submit";
}

export function CopyButton({ text, size = "sm", label, resetMs = 1500, className, type = "button" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      await copyToClipboard(text);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), resetMs);
    },
    [text, resetMs],
  );

  const sizeMap = { xs: "size-2.5", sm: "size-3", md: "size-3.5" };

  if (label) {
    return (
      <button type={type} onClick={handleCopy} className={cn("inline-flex items-center", className)}>
        {copied ? (
          <CheckIcon className={cn(sizeMap[size], "text-emerald-500")} />
        ) : (
          <CopyIcon className={sizeMap[size]} />
        )}
        <span className="ml-1">{label}</span>
      </button>
    );
  }

  return (
    <button type={type} onClick={handleCopy} className={cn("inline-flex items-center", className)}>
      {copied ? (
        <CheckIcon className={cn(sizeMap[size], "text-emerald-500")} />
      ) : (
        <CopyIcon className={sizeMap[size]} />
      )}
    </button>
  );
}
