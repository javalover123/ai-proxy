import { ShieldMinusIcon } from "lucide-react";
import { useRef } from "react";
import {
  LayoutBottomOff,
  LayoutBottomOn,
  LayoutRightOff,
  LayoutRightOn,
  LayoutSidebarOff,
  LayoutSidebarOn,
  ScriptIcon,
} from "@/components/icons";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

export type DetailPosition = "bottom" | "right" | "hidden";

interface BottomBarProps {
  showSidebar: boolean;
  onToggleSidebar: () => void;
  detailPosition: DetailPosition;
  onToggleDetailPosition: (next: DetailPosition) => void;
  scriptEnabled: boolean;
  onToggleScript: () => void;
  sslEnabled: boolean;
  onToggleSsl: () => void;
  aiEnabled: boolean;
  onToggleAi: () => void;
}

export function BottomBar({
  showSidebar,
  onToggleSidebar,
  detailPosition,
  onToggleDetailPosition,
  scriptEnabled,
  onToggleScript,
  sslEnabled,
  onToggleSsl,
  aiEnabled,
  onToggleAi,
}: BottomBarProps) {
  const { t } = useLocale();
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const DetailIconOn = detailPosition === "bottom" ? LayoutBottomOn : LayoutRightOn;
  const DetailIconOff = detailPosition === "bottom" ? LayoutBottomOff : LayoutRightOff;
  const detailTitleKey = detailPosition === "bottom" ? "layout.detailBottom" : "layout.detailRight";

  function handleDetailClick() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      onToggleDetailPosition("hidden");
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onToggleDetailPosition(
          detailPosition === "hidden" ? "bottom" : detailPosition === "bottom" ? "right" : "bottom",
        );
      }, 250);
    }
  }

  return (
    <div className="flex h-7 shrink-0 items-center bg-surface-deep select-none px-2 relative">
      <Separator orientation="horizontal" className="absolute top-0 left-0 right-0" />
      {/* Left: host sidebar toggle */}
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <button
            type="button"
            onClick={onToggleSidebar}
            className={cn(
              "relative inline-flex h-[22px] w-[26px] items-center justify-center rounded-md transition-colors",
              showSidebar
                ? "bg-surface-elevated text-foreground"
                : "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground",
            )}
          >
            {showSidebar && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-foreground/70" />}
            {showSidebar ? <LayoutSidebarOn className="size-4" /> : <LayoutSidebarOff className="size-4" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
          {t("layout.hostSidebar")}
        </TooltipContent>
      </Tooltip>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Center-right: script toggle */}
      <button
        type="button"
        onClick={onToggleScript}
        className={cn(
          "relative inline-flex h-[22px] w-[26px] items-center justify-center rounded-md transition-colors",
          scriptEnabled
            ? "bg-emerald-500/15 text-emerald-400"
            : "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground",
        )}
      >
        {scriptEnabled && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-emerald-400/70" />}
        <ScriptIcon className="size-4" />
      </button>

      {/* Center-right: SSL toggle */}
      <button
        type="button"
        onClick={onToggleSsl}
        className={cn(
          "relative inline-flex h-[22px] w-[26px] items-center justify-center rounded-md transition-colors",
          sslEnabled
            ? "bg-emerald-500/15 text-emerald-400"
            : "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground",
        )}
      >
        {sslEnabled && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-emerald-400/70" />}
        <ShieldMinusIcon className="size-4" />
      </button>

      {/* Center-right: AI detection toggle */}
      <button
        type="button"
        onClick={onToggleAi}
        className={cn(
          "relative inline-flex h-[22px] w-[26px] items-center justify-center rounded-md transition-colors",
          aiEnabled
            ? "bg-violet-500/15 text-violet-400"
            : "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground",
        )}
      >
        {aiEnabled && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-violet-400/70" />}
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
          <circle cx="7.5" cy="14.5" r="1.5" />
          <circle cx="16.5" cy="14.5" r="1.5" />
        </svg>
      </button>

      {/* Right: detail position toggle */}
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <button
            type="button"
            onClick={handleDetailClick}
            className={cn(
              "relative inline-flex h-[22px] w-[26px] items-center justify-center rounded-md transition-colors",
              detailPosition !== "hidden"
                ? "bg-surface-elevated text-foreground"
                : "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground",
            )}
          >
            {detailPosition !== "hidden" && (
              <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-foreground/70" />
            )}
            {detailPosition !== "hidden" ? <DetailIconOn className="size-4" /> : <DetailIconOff className="size-4" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
          {t(detailTitleKey)}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
