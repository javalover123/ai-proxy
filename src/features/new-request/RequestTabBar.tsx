// src/features/new-request/RequestTabBar.tsx

import { ChevronDownIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { EnvController } from "@/hooks/useEnvironments";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { RequestTab } from "@/types/collection";
import { EnvironmentDialog } from "./EnvironmentDialog";

interface RequestTabBarProps {
  tabs: RequestTab[];
  activeTabId: string | null;
  envController: EnvController;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}

export default function RequestTabBar({
  tabs,
  activeTabId,
  envController,
  onActivate,
  onClose,
  onNew,
  onCloseOthers,
  onCloseAll,
}: RequestTabBarProps) {
  const { t } = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [canFit, setCanFit] = useState(true);

  const activeEnvName = envController.activeEnv?.name ?? "";

  // 简单判断：滚动宽度 > 可用宽度 = 放不下
  const checkFit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanFit(el.scrollWidth <= el.clientWidth - 64);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs.length is a trigger
  useEffect(() => {
    checkFit();
  }, [checkFit, tabs.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkFit]);

  // 激活 tab 时自动滚动到该 tab（等 DOM 更新后）
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const tabEl = el.querySelector(`[data-tab-id="${activeTabId}"]`) as HTMLElement | null;
      // 用原生 scrollIntoView，配合 scroll-margin-right 避让 sticky 按钮
      tabEl?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    });
  }, [activeTabId]);

  const handleNew = useCallback(() => {
    onNew();
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    });
  }, [onNew]);

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    onClose(tabId);
  };

  const handleDropdownSelect = useCallback(
    (tabId: string) => {
      onActivate(tabId);
      // useEffect([activeTabId]) 会自动 scrollToTab
    },
    [onActivate],
  );

  const displayName = (tab: RequestTab) => tab.name || t("tab.untitled");

  return (
    <div className="flex shrink-0 items-center border-b border-border bg-surface-base/50">
      {/* 可滚动的 tab 列表 — 所有 tab + 末尾的 [+] [▾] 都在此滚动 */}
      <div
        ref={scrollRef}
        data-tab-list
        className="flex flex-1 items-center overflow-x-auto overflow-y-hidden min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              data-tab-id={tab.id}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(tab.id);
                }
              }}
              className={cn(
                "group/tab relative flex shrink-0 items-center gap-1.5 h-8 max-w-[160px] px-3",
                "text-xs border-r border-border cursor-pointer select-none scroll-mx-[68px]",
                "text-muted-foreground hover:text-foreground transition-colors",
                isActive && "bg-surface-elevated/50 text-foreground",
                isActive &&
                  "before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-accent-foreground",
              )}
            >
              <span
                className={cn(
                  "font-semibold shrink-0",
                  tab.method === "GET" && "text-badge-get",
                  tab.method === "POST" && "text-badge-post",
                  tab.method === "PUT" && "text-badge-put",
                  tab.method === "PATCH" && "text-badge-patch",
                  tab.method === "DELETE" && "text-badge-delete",
                  tab.method === "HEAD" && "text-badge-head",
                  tab.method === "OPTIONS" && "text-badge-options",
                )}
              >
                {tab.method}
              </span>
              <span className="truncate">{displayName(tab)}</span>
              {tab.dirty && tab.linkedNodeId != null && (
                <span className="shrink-0 size-1.5 rounded-full bg-amber-400" aria-label="未保存" />
              )}
              <button
                type="button"
                onClick={(e) => handleClose(e, tab.id)}
                className="shrink-0 ml-0.5 size-3.5 flex items-center justify-center rounded-sm
                           opacity-0 group-hover/tab:opacity-100 hover:bg-border/50 transition-opacity"
                aria-label="Close"
              >
                <XIcon className="size-2.5" />
              </button>
            </div>
          );
        })}

        {/* [+] [▾] 紧跟最后一个 tab；sticky 保证溢出时始终可见 */}
        <div
          data-sticky-buttons
          className="sticky right-0 flex shrink-0 items-center bg-surface-base/50 backdrop-blur-sm rounded"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 shrink-0"
            onClick={handleNew}
            aria-label={t("tab.newRequest")}
          >
            <svg
              className="size-2.5"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="5" y1="1" x2="5" y2="9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
          </Button>

          {tabs.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                aria-label="More tabs"
              >
                <ChevronDownIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                {!canFit &&
                  tabs.map((tab) => (
                    <DropdownMenuItem key={tab.id} onClick={() => handleDropdownSelect(tab.id)}>
                      <span
                        className={cn(
                          "font-semibold text-ui-sm",
                          tab.method === "GET" && "text-badge-get",
                          tab.method === "POST" && "text-badge-post",
                          tab.method === "PUT" && "text-badge-put",
                          tab.method === "PATCH" && "text-badge-patch",
                          tab.method === "DELETE" && "text-badge-delete",
                          tab.method === "HEAD" && "text-badge-head",
                          tab.method === "OPTIONS" && "text-badge-options",
                        )}
                      >
                        {tab.method}
                      </span>
                      <span className="ml-1.5 truncate text-xs">{displayName(tab)}</span>
                    </DropdownMenuItem>
                  ))}
                {!canFit && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={onCloseOthers}>{t("tab.closeOthers")}</DropdownMenuItem>
                <DropdownMenuItem onClick={onCloseAll}>{t("tab.closeAll")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* 环境切换 — 滚动区外，最右侧 */}
      <Select
        value={envController.activeEnvId != null ? String(envController.activeEnvId) : ""}
        onValueChange={(v) => {
          if (v) envController.setActiveEnv(Number(v));
        }}
      >
        <SelectTrigger className="h-7 w-auto px-2 shrink-0 gap-1 text-xs border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[size=sm]:h-7 text-muted-foreground hover:text-foreground transition-colors">
          <span className="flex-1 text-left">{activeEnvName}</span>
        </SelectTrigger>
        <SelectContent
          align="start"
          side="bottom"
          alignItemWithTrigger={false}
          sideOffset={4}
          className="min-w-[100px] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:text-xs"
        >
          {envController.environments.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 环境管理按钮 — 滚动区外 */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-7 w-7 shrink-0 ml-0.5"
        onClick={() => setEnvDialogOpen(true)}
        aria-label={t("tab.envManagement")}
      >
        <svg
          className="size-3"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <line x1="1" y1="2.5" x2="11" y2="2.5" />
          <line x1="1" y1="6" x2="11" y2="6" />
          <line x1="1" y1="9.5" x2="11" y2="9.5" />
        </svg>
      </Button>

      {/* 环境管理弹窗 */}
      <EnvironmentDialog open={envDialogOpen} onOpenChange={setEnvDialogOpen} controller={envController} />
    </div>
  );
}
