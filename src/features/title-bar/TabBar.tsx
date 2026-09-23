import { XIcon } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { ScriptTab, ViewId } from "@/types/view";

const VIEW_TABS: { id: ViewId; labelKey: string; closable?: boolean }[] = [
  { id: "proxy", labelKey: "view.proxy", closable: false },
  { id: "new-request", labelKey: "view.newRequest", closable: true },
  { id: "ai", labelKey: "view.ai", closable: true },
];

interface TabBarProps {
  activeTabId: string;
  scriptTabs: ScriptTab[];
  mountedViews: Set<ViewId>;
  onViewChange: (view: ViewId) => void;
  onCloseTab: (view: ViewId) => void;
  onSelectScriptTab: (fileKey: string) => void;
  onCloseScriptTab: (fileKey: string) => void;
}

function stopTitleBarDrag(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function TabBar({
  activeTabId,
  scriptTabs,
  mountedViews,
  onViewChange,
  onCloseTab,
  onSelectScriptTab,
  onCloseScriptTab,
}: TabBarProps) {
  const { t } = useLocale();

  // Only proxy mounted → hide the entire tab bar
  if (mountedViews.size <= 1 && scriptTabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1" data-tauri-drag-region={false}>
      {/* Static view tabs */}
      {VIEW_TABS.filter(({ id }) => mountedViews.has(id)).map(({ id, labelKey, closable }) => (
        <button
          key={id}
          type="button"
          data-tauri-drag-region={false}
          onMouseDown={stopTitleBarDrag}
          onPointerDown={stopTitleBarDrag}
          onClick={() => onViewChange(id)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-ui-sm font-medium transition-colors",
            activeTabId === id
              ? "bg-surface-elevated/50 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(labelKey)}
          {closable && (
            <span
              role="button"
              tabIndex={-1}
              data-tauri-drag-region={false}
              onMouseDown={stopTitleBarDrag}
              onPointerDown={stopTitleBarDrag}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(id);
              }}
              className={cn(
                "inline-flex items-center justify-center rounded p-0.5 transition-colors",
                "text-muted-foreground/50 hover:text-muted-foreground hover:bg-surface-elevated/30",
              )}
            >
              <XIcon className="size-3" />
            </span>
          )}
        </button>
      ))}

      {/* Separator between static views and script tabs */}
      {scriptTabs.length > 0 && <span className="mx-0.5 h-4 w-px bg-surface-elevated" />}

      {/* Dynamic script tabs */}
      {scriptTabs.map((tab) => (
        <button
          key={tab.fileKey}
          type="button"
          data-tauri-drag-region={false}
          onMouseDown={stopTitleBarDrag}
          onPointerDown={stopTitleBarDrag}
          onClick={() => onSelectScriptTab(tab.fileKey)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-ui-sm font-medium transition-colors",
            activeTabId === tab.fileKey
              ? "bg-surface-elevated/50 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            className={cn(
              tab.dirty &&
                "after:ml-0.5 after:inline-block after:h-1.5 after:w-1.5 after:rounded-full after:bg-ai-user-bubble",
            )}
          >
            {tab.label}
          </span>
          <span
            role="button"
            tabIndex={-1}
            data-tauri-drag-region={false}
            onMouseDown={stopTitleBarDrag}
            onPointerDown={stopTitleBarDrag}
            onClick={(e) => {
              e.stopPropagation();
              onCloseScriptTab(tab.fileKey);
            }}
            className={cn(
              "inline-flex items-center justify-center rounded p-0.5 transition-colors",
              "text-muted-foreground/50 hover:text-muted-foreground hover:bg-surface-elevated/30",
            )}
          >
            <XIcon className="size-3" />
          </span>
        </button>
      ))}
    </div>
  );
}
