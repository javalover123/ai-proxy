import { ChevronRightIcon, PinIcon, PinOffIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  domains: [string, number][];
  totalEntries: number;
  selectedDomain: string | null;
  onSelectDomain: (domain: string | null) => void;
  pinnedDomains: Set<string>;
  onTogglePin: (domain: string) => void;
}

export default function DomainSidebar({
  domains,
  totalEntries,
  selectedDomain,
  onSelectDomain,
  pinnedDomains,
  onTogglePin,
}: Props) {
  const { t } = useTranslation();
  const [listCollapsed, setListCollapsed] = useState(false);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);

  const pinned = domains.filter(([host]) => pinnedDomains.has(host));

  return (
    <div className="flex flex-col h-full border-r border-surface-elevated overflow-hidden bg-surface-base">
      <div className="flex items-center px-3 py-2">
        <span className="text-ui-xs font-semibold uppercase tracking-wide text-muted-foreground select-none">
          {t("hosts.title")}
        </span>
      </div>
      <Separator />
      <ScrollArea className="flex-1 min-h-0 bg-surface-base">
        {/* 置顶折叠组 */}
        <Collapsible open={!pinnedCollapsed} onOpenChange={(v) => setPinnedCollapsed(!v)}>
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-surface-elevated/50 text-foreground/80">
            <CollapsibleTrigger className="shrink-0 p-0 rounded hover:bg-surface-elevated/50 transition-colors">
              <ChevronRightIcon className={`size-3 transition-transform ${pinnedCollapsed ? "" : "rotate-90"}`} />
            </CollapsibleTrigger>
            <span className="flex-1 truncate font-medium text-amber-500">{t("hosts.pinned")}</span>
            <span className="text-muted-foreground tabular-nums text-ui-xs">{pinned.length}</span>
          </div>
          <CollapsibleContent>
            {pinned.map(([host, count]) => (
              <div
                key={host}
                className={cn(
                  "flex items-center gap-1 pl-7 pr-2 py-1.5 text-xs cursor-pointer transition-colors border-b border-surface-elevated/30 list-item-base",
                  selectedDomain === host
                    ? "list-item-selected text-foreground"
                    : "hover:bg-surface-elevated/50 text-muted-foreground",
                )}
                style={{ borderLeftWidth: 3 }}
                onClick={() => onSelectDomain(host)}
              >
                <Tooltip>
                  <TooltipTrigger className="flex-1 truncate text-left">
                    <span>{host}</span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    className="max-w-[320px] bg-popover text-popover-foreground text-ui-sm"
                  >
                    {host}
                  </TooltipContent>
                </Tooltip>
                <span className="text-muted-foreground tabular-nums text-ui-xs">{count}</span>
                <button
                  className="shrink-0 p-0 rounded hover:bg-surface-elevated/50 text-amber-500 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(host);
                  }}
                >
                  <PinOffIcon className="size-3" />
                </button>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
        {/* 全部 */}
        <Collapsible open={!listCollapsed} onOpenChange={(v) => setListCollapsed(!v)}>
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors list-item-base",
              !selectedDomain
                ? "list-item-selected text-foreground"
                : "hover:bg-surface-elevated/50 text-muted-foreground",
            )}
            style={{ borderLeftWidth: 3 }}
          >
            <CollapsibleTrigger className="shrink-0 p-0 rounded hover:bg-surface-elevated/50 transition-colors">
              <ChevronRightIcon className={`size-3 transition-transform ${listCollapsed ? "" : "rotate-90"}`} />
            </CollapsibleTrigger>
            <span className="flex-1 truncate font-medium" onClick={() => onSelectDomain(null)}>
              {t("hosts.all")}
            </span>
            <span className="text-muted-foreground tabular-nums text-ui-xs">{totalEntries}</span>
          </div>
          <CollapsibleContent>
            {domains.map(([host, count]) => (
              <div
                key={host}
                className={cn(
                  "flex items-center gap-1 pl-7 pr-2 py-1.5 text-xs cursor-pointer transition-colors border-b border-surface-elevated/30 group list-item-base",
                  selectedDomain === host
                    ? "list-item-selected text-foreground"
                    : "hover:bg-surface-elevated/50 text-muted-foreground",
                )}
                style={{ borderLeftWidth: 3 }}
                onClick={() => onSelectDomain(host)}
              >
                <span className="flex-1 truncate" title={host}>
                  {host}
                </span>
                <span className="text-muted-foreground tabular-nums text-ui-xs">{count}</span>
                <button
                  className="shrink-0 p-0 rounded hover:bg-surface-elevated/50 text-muted-foreground hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(host);
                  }}
                >
                  <PinIcon className="size-3" />
                </button>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </ScrollArea>
    </div>
  );
}
