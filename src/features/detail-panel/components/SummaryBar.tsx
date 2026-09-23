import { TriangleAlertIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/core/CopyButton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration, statusCategory } from "@/lib/format";
import { METHOD_BG_COLORS } from "@/lib/http-constants";
import type { TrafficEntry } from "@/types/proxy";

const METHOD_COLOR_VAR = (method: string) => {
  const v = (METHOD_BG_COLORS as Record<string, string>)[method.toUpperCase()];
  return v ?? "var(--badge-get)";
};

export default function SummaryBar({
  entry,
  onClose,
  showUriTooltip = true,
}: {
  entry: TrafficEntry;
  onClose?: () => void;
  showUriTooltip?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-surface-elevated px-3 py-1.5 text-prose-md">
      <Badge
        className="shrink-0 rounded font-semibold uppercase"
        style={{
          color: METHOD_COLOR_VAR(entry.method),
          background: `color-mix(in oklch, ${METHOD_COLOR_VAR(entry.method)} 10%, transparent)`,
          borderColor: `color-mix(in oklch, ${METHOD_COLOR_VAR(entry.method)} 20%, transparent)`,
        }}
      >
        {entry.method}
      </Badge>
      <Badge
        className="shrink-0 rounded font-semibold"
        style={{
          color: entry.error ? "var(--badge-error)" : `var(--badge-${statusCategory(entry.status ?? 0)})`,
        }}
      >
        {entry.error != null && <span className="inline-block size-1.5 rounded-full bg-current" />}
        {entry.error != null ? t("detail.errorStatus") : (entry.status ?? t("detail.pending"))}
      </Badge>
      {entry.terminated != null && (
        <Tooltip>
          <TooltipTrigger className="inline-flex shrink-0">
            <Badge
              className="shrink-0 rounded gap-1 font-semibold"
              style={{
                color: "var(--badge-warning)",
                background: "color-mix(in oklch, var(--badge-warning) 10%, transparent)",
                borderColor: "color-mix(in oklch, var(--badge-warning) 20%, transparent)",
              }}
            >
              <TriangleAlertIcon className="size-3" />
              {t(`detail.terminated.${entry.terminated}`)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[360px] bg-popover text-popover-foreground text-ui-sm">
            {t(`detail.terminatedHint.${entry.terminated}`)}
          </TooltipContent>
        </Tooltip>
      )}
      {showUriTooltip ? (
        <Tooltip>
          <TooltipTrigger className="min-w-0 flex-1 truncate text-left">
            <span className="truncate text-foreground">{entry.uri}</span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="max-w-[500px] bg-popover text-popover-foreground font-mono text-ui-sm"
          >
            {entry.uri}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="min-w-0 flex-1 truncate text-left text-foreground">{entry.uri}</span>
      )}
      {onClose && (
        <Tooltip>
          <TooltipTrigger className="inline-flex shrink-0">
            <button
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50 transition-colors"
            >
              <XIcon className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
            关闭详情
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger className="inline-flex shrink-0">
          <CopyButton
            text={entry.uri}
            size="sm"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50 transition-colors"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
          {t("detail.copyUri")}
        </TooltipContent>
      </Tooltip>
      {entry.durationMs != null && (
        <span className="shrink-0 text-muted-foreground tabular-nums">{formatDuration(entry.durationMs)}</span>
      )}
    </div>
  );
}
