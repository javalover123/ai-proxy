import { CircleHelpIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HintIconProps {
  /** 提示文案（已本地化），悬停或点击问号（聚焦）时弹出 */
  label: string;
}

/** 小问号图标 + tooltip：把字段说明收进问号，减少界面上的说明文字。 */
export function HintIcon({ label }: HintIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex rounded-sm text-muted-foreground/70 transition-colors hover:text-muted-foreground focus-visible:ring-1">
        <CircleHelpIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] bg-popover text-popover-foreground text-ui-sm">{label}</TooltipContent>
    </Tooltip>
  );
}
