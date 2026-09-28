import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import i18n from "@/i18n";
import { formatTokenCount, formatTokenExact } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Token 展示组件：缩略值 + hover 显示精确千分位数字（仅缩略时显示 tooltip） */
export function TokenValue({ value, className }: { value: number | null | undefined; className?: string }) {
  const locale = i18n.language?.startsWith("zh") ? "zh" : "en";
  const display = formatTokenCount(value, locale);
  const exact = formatTokenExact(value);
  const isAbbreviated = display.startsWith("≈");

  if (!isAbbreviated) return <span className={className}>{display}</span>;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("cursor-default", className)}>{display}</span>} />
      <TooltipContent
        side="top"
        className="bg-popover text-popover-foreground border border-border text-ui-sm px-2 py-1"
      >
        <span className="font-mono tabular-nums">{exact}</span>
        <span className="text-muted-foreground ml-1">tokens</span>
      </TooltipContent>
    </Tooltip>
  );
}
