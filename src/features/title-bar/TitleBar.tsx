import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlignJustifyIcon,
  CodeIcon,
  InfoIcon,
  LogOutIcon,
  MinusIcon,
  PlayIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import appIcon from "@/assets/app-icon.png";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { ScriptTab, ViewId } from "@/types/view";
import { TabBar } from "./TabBar";

type TitleBarProps = {
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onOpenSslConfig: () => void;
  onOpenScriptConfig: () => void;
  onOpenAiConfig: () => void;
  running: boolean;
  onStartProxy: () => void;
  onStopProxy: () => void;
  onClearTraffic: () => void;
  mountedViews: Set<ViewId>;
  onViewChange: (view: ViewId) => void;
  onCloseTab: (view: ViewId) => void;
  toolbarExpanded: boolean;
  onToolbarToggle: (expanded: boolean) => void;
  scriptTabs: ScriptTab[];
  activeTabId: string;
  onSelectScriptTab: (fileKey: string) => void;
  onCloseScriptTab: (fileKey: string) => void;
};

function stopTitleBarDrag(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

type MenuId = "ai-proxy" | "tools";

function TitleBarMenu({
  label,
  menuId,
  activeMenu,
  onMenuChange,
  children,
}: {
  label: string;
  menuId: MenuId;
  activeMenu: MenuId | null;
  onMenuChange: (id: MenuId | null) => void;
  children: (close: () => void) => ReactNode;
}) {
  const open = activeMenu === menuId;
  const rootRef = useRef<HTMLDivElement>(null);

  function close() {
    onMenuChange(null);
  }

  function requestOpen() {
    onMenuChange(menuId);
  }

  // 菜单打开时，点击外部关闭
  useClickOutside(rootRef, close, open);

  return (
    <div ref={rootRef} className="relative h-full" data-tauri-drag-region={false} onMouseEnter={requestOpen}>
      <button
        type="button"
        data-tauri-drag-region={false}
        aria-expanded={open}
        aria-haspopup="menu"
        onMouseDown={stopTitleBarDrag}
        onPointerDown={stopTitleBarDrag}
        className={cn(
          "inline-flex h-8 items-center rounded-none border-0 px-2.5 text-ui-md text-foreground/80 shadow-none outline-none transition-colors hover:bg-surface-elevated/50 hover:text-foreground focus:outline-none focus-visible:outline-none",
          open && "bg-surface-elevated/50 text-foreground",
        )}
      >
        {label}
      </button>
      {open ? (
        <div
          role="menu"
          data-tauri-drag-region={false}
          className="absolute top-full left-0 z-[200] min-w-32 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  variant = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-tauri-drag-region={false}
      onMouseDown={stopTitleBarDrag}
      onPointerDown={stopTitleBarDrag}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground",
        variant === "destructive" && "text-destructive hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

function WindowButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tauri-drag-region={false}
      onMouseDown={stopTitleBarDrag}
      onPointerDown={stopTitleBarDrag}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-11 items-center justify-center text-foreground/70 outline-none transition-colors hover:bg-surface-elevated/50 hover:text-foreground focus:outline-none focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </button>
  );
}
export function TitleBar({
  onOpenSettings,
  onOpenAbout,
  onOpenSslConfig,
  onOpenScriptConfig,
  onOpenAiConfig,
  running,
  onStartProxy,
  onStopProxy,
  onClearTraffic,
  mountedViews,
  onViewChange,
  onCloseTab,
  toolbarExpanded,
  onToolbarToggle,
  scriptTabs,
  activeTabId,
  onSelectScriptTab,
  onCloseScriptTab,
}: TitleBarProps) {
  const { t } = useLocale();
  const appWindow = getCurrentWindow();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);

  // 展开工具栏时默认打开第一个菜单
  useEffect(() => {
    if (toolbarExpanded) {
      setActiveMenu("ai-proxy");
    } else {
      setActiveMenu(null);
    }
  }, [toolbarExpanded]);

  // 点击外部区域时收起工具栏
  useClickOutside(toolbarRef, () => onToolbarToggle(false), toolbarExpanded);

  async function handleQuit() {
    await appWindow?.close();
  }

  return (
    <div
      className="titlebar relative flex h-8 shrink-0 items-center border-b border-surface-elevated bg-surface-base select-none"
      data-tauri-drag-region="deep"
    >
      <img src={appIcon} alt="" className="ml-2 size-4 shrink-0" draggable={false} />

      {/* Toolbar toggle button — hidden when expanded */}
      {!toolbarExpanded && (
        <button
          type="button"
          data-tauri-drag-region={false}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onToolbarToggle(true);
          }}
          className="inline-flex h-8 w-8 items-center justify-center text-foreground/70 outline-none transition-colors hover:bg-surface-elevated/50 hover:text-foreground focus:outline-none focus-visible:outline-none"
        >
          <AlignJustifyIcon className="size-4" />
        </button>
      )}

      {/* Expanded toolbar: "AI Proxy" + "Tools" menus with progressive gradient background */}
      <div
        ref={toolbarRef}
        data-tauri-drag-region={false}
        className={cn(
          "flex h-full items-center transition-all duration-200 ease-out",
          toolbarExpanded ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none absolute",
        )}
        style={
          toolbarExpanded
            ? {
                background:
                  "linear-gradient(to right, var(--surface-elevated) 0%, color-mix(in oklch, var(--surface-elevated) 60%, transparent) 40%, color-mix(in oklch, var(--surface-elevated) 20%, transparent) 70%, transparent 100%)",
              }
            : undefined
        }
      >
        <TitleBarMenu label="AI Proxy" menuId="ai-proxy" activeMenu={activeMenu} onMenuChange={setActiveMenu}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  onOpenSettings();
                }}
              >
                <SettingsIcon className="size-4" />
                {t("menu.settings")}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  onOpenAbout();
                }}
              >
                <InfoIcon className="size-4" />
                {t("menu.about")}
              </MenuItem>
              <div className="my-1 h-px bg-surface-elevated" />
              <MenuItem
                variant="destructive"
                onClick={() => {
                  close();
                  void handleQuit();
                }}
              >
                <LogOutIcon className="size-4" />
                {t("menu.quit")}
              </MenuItem>
            </>
          )}
        </TitleBarMenu>
        <TitleBarMenu label={t("menu.tools")} menuId="tools" activeMenu={activeMenu} onMenuChange={setActiveMenu}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  onOpenSslConfig();
                }}
              >
                <ShieldCheckIcon className="size-4" />
                {t("menu.sslConfig")}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  onOpenAiConfig();
                }}
              >
                <SparklesIcon className="size-4" />
                {t("menu.aiConfig")}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  onOpenScriptConfig();
                }}
              >
                <CodeIcon className="size-4" />
                {t("menu.scriptConfig")}
              </MenuItem>
            </>
          )}
        </TitleBarMenu>
      </div>

      {/* View tabs */}
      {!toolbarExpanded && (
        <TabBar
          activeTabId={activeTabId}
          scriptTabs={scriptTabs}
          mountedViews={mountedViews}
          onViewChange={onViewChange}
          onCloseTab={onCloseTab}
          onSelectScriptTab={onSelectScriptTab}
          onCloseScriptTab={onCloseScriptTab}
        />
      )}

      {/* Spacer: pushes right-side buttons to the far right */}
      <div className="min-w-0 flex-1" data-tauri-drag-region />

      {/* Far-right group: Delete, Start/Stop — order from left to right */}
      {!toolbarExpanded && (
        <div className="flex items-center gap-1" data-tauri-drag-region={false}>
          <Tooltip>
            <TooltipTrigger
              data-tauri-drag-region={false}
              onMouseDown={stopTitleBarDrag}
              onPointerDown={stopTitleBarDrag}
              onClick={onClearTraffic}
              className="inline-flex items-center rounded-md px-2 py-1 text-ui-sm font-medium bg-surface-elevated text-muted-foreground border border-border hover:bg-muted transition-colors"
            >
              <Trash2Icon className="size-3" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
              {t("traffic.clear")}
            </TooltipContent>
          </Tooltip>
          {running ? (
            <Tooltip>
              <TooltipTrigger
                data-tauri-drag-region={false}
                onMouseDown={stopTitleBarDrag}
                onPointerDown={stopTitleBarDrag}
                onClick={onStopProxy}
                className="inline-flex items-center rounded-md px-2 py-1 text-ui-sm font-medium bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors"
              >
                <SquareIcon className="size-3" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
                {t("app.stop")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                data-tauri-drag-region={false}
                onMouseDown={stopTitleBarDrag}
                onPointerDown={stopTitleBarDrag}
                onClick={onStartProxy}
                className="inline-flex items-center rounded-md px-2 py-1 text-ui-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
              >
                <PlayIcon className="size-3" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
                {t("app.start")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      <div className="flex h-full items-center" data-tauri-drag-region={false}>
        <WindowButton label="Minimize" onClick={() => void appWindow?.minimize()}>
          <MinusIcon className="size-3.5" />
        </WindowButton>
        <WindowButton label="Maximize" onClick={() => void appWindow?.toggleMaximize()}>
          <SquareIcon className="size-3" />
        </WindowButton>
        <WindowButton
          label="Close"
          onClick={() => void appWindow?.close()}
          className="hover:bg-destructive hover:text-destructive-foreground"
        >
          <XIcon className="size-3.5" />
        </WindowButton>
      </div>
    </div>
  );
}
