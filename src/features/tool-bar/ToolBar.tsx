import { GlobeIcon, SparklesIcon, SquarePenIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/types/view";

const VIEW_ITEMS: { id: ViewId; icon: typeof GlobeIcon; labelKey: string }[] = [
  { id: "proxy", icon: GlobeIcon, labelKey: "view.proxy" },
  { id: "new-request", icon: SquarePenIcon, labelKey: "view.newRequest" },
  { id: "ai", icon: SparklesIcon, labelKey: "view.ai" },
];

interface ToolBarProps {
  activeTabId: string;
  mountedViews: Set<ViewId>;
  onViewChange: (view: ViewId) => void;
}

export function ToolBar({ activeTabId, mountedViews, onViewChange }: ToolBarProps) {
  const { t } = useLocale();

  return (
    <div className="flex w-[42px] shrink-0 flex-col items-center border-r border-border bg-surface-deep py-1.5">
      {VIEW_ITEMS.map(({ id, icon: Icon, labelKey }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            onClick={() => onViewChange(id)}
            className={cn(
              "inline-flex relative h-8 w-8 items-center justify-center rounded-md transition-colors my-0.5",
              activeTabId === id
                ? "bg-surface-elevated text-foreground"
                : mountedViews.has(id)
                  ? "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground"
                  : "text-muted-foreground/50 hover:bg-surface-elevated/50 hover:text-foreground",
            )}
          >
            <Icon className="size-[18px]" />
            {activeTabId === id && (
              <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-primary" />
            )}
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="bg-popover text-popover-foreground text-ui-sm">
            {t(labelKey)}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
